# Setup

## Requirements

- macOS on Apple Silicon (or any host Multipass supports) with one VM backend:
  - **Multipass 1.13+** (snapshots need 1.13), the default; or
  - **Tart**, which is better when several macOS accounts each need a lab. See [Tart backend](#tart-backend).
- Node.js 22.13 or newer. The store uses the built-in `node:sqlite`, so nothing native has to compile.
- About **6 GB RAM** and **60 GB disk** free while a lab runs. There are 3 VMs at 2 vCPU / 2 GB / 20 GB each; sizes are in `config/versions.yaml`.

## First run

```bash
npm install

# Only needed if multipass says "The client is not authenticated" (e.g. in a new terminal app):
multipass set local.passphrase      # once, as the user that installed Multipass
multipass authenticate              # in the terminal that will run cka

./cka images build                  # 15-25 minutes; creates cka-controlplane, cka-worker-1, cka-worker-2
./cka images list                   # bare: available, cluster: available
```

The build:

1. launches 3 Ubuntu VMs and installs containerd, kubeadm, kubelet and kubectl at the version pinned in `config/versions.yaml`, adds the extras (below), then snapshots **`bare`**;
2. runs `kubeadm init`, installs Calico, joins the workers, waits for everything to be Ready, installs Helm, the Gateway API CRDs and Traefik (see below), then snapshots **`cluster`**;
3. writes `~/.cka-lab/images.json` (build date, versions, node IPs, `addons`) and leaves the VMs stopped.

The node images also pre-pull every container image the scenarios use, so sessions do not depend on Docker Hub. The controller manager runs with `--node-monitor-grace-period=20s`, so a worker whose kubelet stops turns `NotReady` after about 20 seconds instead of the stock 40-50.

**Ingress and Gateway API.** The `cluster` image ships one Traefik controller that serves both Ingress and Gateway API traffic:

- the IngressClass `traefik`, which is the default class;
- the GatewayClass `traefik`, and the Gateway `traefik-gateway` in namespace `traefik`, whose `web` listener (HTTP) accepts routes from every namespace;
- the NodePorts `30080` (HTTP) and `30443` (HTTPS) on every node, e.g. `curl -H 'Host: app.example.local' http://controlplane:30080/`.

The versions are pinned in `config/versions.yaml` (`gatewayApiVersion`, `traefikChartVersion`, `helmVersion`). Images built before this change lack all three. Quick Create questions that need them (the Ingress and HTTPRoute category, and the Ingress and HTTPRoute add-ons) stop with a clear error at setup until you rebuild with `./cka images build --force`.

**Extras.** The upgrade and dynamic provisioning questions run offline from content the build adds to every node (`tools/build-base-images/node-extras.sh`):

- a local apt repository in `/opt/cka/apt` with kubeadm, kubelet and kubectl at `kubernetesVersion` and at the newest patch of `kubernetesPreviousVersion`, and `/opt/cka/versions.env` naming both;
- the control plane images of both versions;
- the local-path provisioner image (`localPathProvisionerVersion`) and, on controlplane, its manifest in `/opt/cka/addons/local-path-storage.yaml`, pinned to pre-pulled images.

Images built before the extras existed get them with `./cka images extras` (5-10 minutes, needs the internet). It restores `bare`, adds the extras, re-snapshots, does the same for `cluster`, and records them in `images.json`. Until then those questions stop at setup with a message naming the command.

Per-node build logs go to `~/.cka-lab/logs/build-*.log`. To rebuild from scratch, for example after bumping versions or once the certificates near their one-year expiry, run `./cka images build --force`.

## Running

```bash
npm run dev          # API on :4317 + UI on http://localhost:5173 (hot reload)
# or
npm start            # builds the UI and serves everything from http://127.0.0.1:4317
```

From the terminal only:

```bash
./cka list
./cka start ts-kubelet-stopped     # restores 'cluster', runs setup, prints the task and ssh commands
./cka grade
./cka hint | solution | reset | status | end
```

Starting or resetting a scenario stops the VMs, restores the snapshot, boots them, waits for the cluster to be healthy, then runs the scenario's setup. Ending a session stops the VMs to free memory.

## Connecting to the lab

The connection panel and `./cka connection` show:

- one `ssh -i ~/.cka-lab/keys/session ... ubuntu@<ip>` command per node. A fresh key pair is generated and installed on every start.
- `export KUBECONFIG=~/.cka-lab/session/kubeconfig`, if you have kubectl on your Mac. You can also download it from the UI.

The control plane shell matches the exam: `alias k=kubectl` with completion, `$do` (`--dry-run=client -o yaml`), `$now` (`--force --grace-period 0`), vim with 2-space tabs, and `ssh worker-1` / `ssh worker-2` without a password.

### Browser terminal

The session page has a terminal with one tab per node. Each tab is an SSH session as `ubuntu`, opened by the API server with the same per-session key, so it behaves exactly like the commands above. Tabs connect the first time you open them and stay connected while you switch between them.

- The terminal only accepts connections from the UI itself (`http://127.0.0.1:4317`, `localhost`, or the Vite dev server on port 5173); other websites cannot open a shell through it.
- **Fullscreen** in the terminal header switches to focus mode: the task, hints and Grade button on the left, the terminal tabs on the right. Your shells stay connected when you switch; use the button again to leave (Esc is left to vim).
- Reset and End close all terminals. After a reset, they reconnect on their own once the lab is ready again.
- It needs real lab VMs (Multipass or Tart); with `CKA_DRIVER=fake` it only prints a notice.
- The browser closes the tab on Cmd/Ctrl+W, so the page asks for confirmation before leaving while a terminal is connected.

## Files and state

| Path | What |
| --- | --- |
| `~/.cka-lab/state.db` | SQLite: sessions, attempts, check results |
| `~/.cka-lab/logs/orchestrator.log` | every orchestrator operation (JSON lines) |
| `~/.cka-lab/keys/session` | per-session SSH key |
| `~/.cka-lab/session/kubeconfig` | admin kubeconfig of the running lab |
| `~/.cka-lab/images.json` | metadata of the most recently built images, including their `driver` |
| `~/.cka-lab/images-<driver>.json` | the same, per backend, so a Multipass and a Tart lab can coexist |
| `~/.cka-lab/keys/driver` | Tart only: the key the driver uses to run commands on the nodes |

Set `CKA_LAB_HOME` to move this directory. Nothing in it belongs in git.

## Tart backend

[Tart](https://tart.run) runs macOS virtualization-framework VMs without a shared daemon. VMs live per user in `~/.tart` (or `TART_HOME`), so every macOS account builds and owns its own lab, and accounts do not interfere with each other. That avoids the Multipass socket and authentication problems with several accounts.

```bash
brew install cirruslabs/cli/tart
./cka images build --driver tart    # same steps as Multipass, about the same time
./cka images list                   # driver: tart
```

- **How it works:** Tart has no snapshots, so the build keeps golden VMs per node (`cka-<node>-bare`, `cka-<node>-cluster`). Starting or resetting a lab deletes the session VMs `cka-<node>` and clones them from the golden ones. The clones are APFS copy-on-write, so this takes about a second. The VMs run headless (`tart run --no-graphics`, logs in `~/.cka-lab/logs/tart-<node>.log`) and keep running if the API restarts.
- **Commands** run over SSH as `ubuntu` with `~/.cka-lab/keys/driver`, created by the build. The per-session key, kubeconfig and browser terminal work as with Multipass.
- **Choosing the driver:** `CKA_DRIVER=tart|multipass` wins. Otherwise the driver of the most recent `./cka images build` is used (`images.json`), falling back to Multipass. Both labs can exist side by side; switch with `CKA_DRIVER`.
- **Networking:**
  - **Static addresses:** the build pins each node's DHCP address in a static netplan config, because the cluster certificates are bound to it. Clones get a new MAC address and never ask for a lease again, so the driver uses the recorded addresses. It checks each node's hostname over SSH, so an address taken over by another VM fails with a clear error.
  - **Isolation:** macOS 26 isolates Virtualization.framework VMs from each other on the shared network, and only the Mac can reach them. Each node therefore routes the other nodes' addresses through the Mac (192.168.64.1), which forwards TCP, UDP and ICMP but not IP-in-IP. For that reason Calico uses VXLAN on Tart, instead of IP-in-IP as on Multipass.
  - **Pod CIDR:** the pod CIDR in `config/versions.yaml` must not overlap the vmnet subnet (192.168.64.0/24 by default).
- **Stopping:** `tart stop` cuts a Linux guest off without flushing its disk cache. Snapshots therefore power off from inside the guest; restores and session ends stop hard, because those disks are thrown away.
- **Disk:** 9 VMs (3 golden `bare`, 3 golden `cluster`, 3 session clones). Clones share blocks until they diverge, so real usage stays around the Multipass figure. `tart list` shows them; `./cka images build --driver tart --force` deletes and rebuilds all of them.
- **Base image:** `ghcr.io/cirruslabs/ubuntu:<ubuntuRelease>`, overridable with `CKA_TART_IMAGE`. The build uses the image's default `admin`/`admin` login once to create the `ubuntu` user. `CKA_TART_BIN` overrides the `tart` binary.
- **Licence:** Tart is fair-source, not open source; larger organisations may need a paid licence. Check the current terms on [tart.run](https://tart.run) for your use.

## AWS Labs (Floci)

The AWS section (`/aws`) runs Solutions Architect Associate scenarios against [Floci](https://github.com/floci-io/floci), a local AWS emulator, instead of the lab VMs. It needs:

- **Docker** running. Floci starts EC2 instances and RDS databases as containers.
- **Floci** listening on `http://localhost:4566`: `floci start` (or `docker run -d --name floci -p 4566:4566 -v /var/run/docker.sock:/var/run/docker.sock floci/floci:latest`). The scenarios were checked against Floci 1.7.0.
- **AWS CLI v2** on `PATH` (`brew install awscli`), and `python3`, which the browser terminal and some checks use.

The scenario list shows whether Floci and the CLI are found, and checks again every few seconds until they are.

Each attempt gets its own new 12-digit AWS account on Floci, so it starts empty and cannot see other attempts; Reset starts another account. Nothing else is provisioned, so a lab is ready in a few seconds. Commands run on this machine with a session-only AWS CLI config in `~/.cka-lab/aws/<session>/`: dummy credentials, the Floci endpoint, and none of your own `~/.aws` settings. The browser terminal is a local bash shell with that setup, in the session's `work/` folder. To use your own terminal instead, copy the export line from the Connect panel.

`CKA_FLOCI_URL` points at another Floci. It must be on this machine unless `CKA_FLOCI_ALLOW_REMOTE=1` is set, so a typo cannot send lab commands elsewhere.

Ending or resetting a session terminates the account's EC2 instances and deletes its RDS databases, which would otherwise keep running as containers. Everything else in an abandoned account is only records in Floci's memory, and goes when Floci restarts.

Floci is an emulator, so some things differ from AWS. The scenarios are written around these:

- It accepts much of what AWS rejects: a subnet outside its VPC's CIDR, overlapping subnets, a one-AZ DB subnet group. Checks therefore compare exact values.
- Auto Scaling groups keep their configuration but launch no instances.
- RDS does not keep the backup retention, storage encryption or deletion protection settings, and has no read replicas.
- NAT gateways, peering and Route 53 records are records only; no traffic flows through them. Labs grade configuration, not connectivity.
- `ModifyVpcEndpoint` is not supported: give gateway endpoints their route tables when you create them.

## Developing without VMs

`CKA_DRIVER=fake npm run dev` runs the API against a simulated lab. Provisioning steps are faked, and every command returns empty output, so most checks fail. It uses a separate `state-fake.db`, which keeps fake attempts out of your real history.

## Troubleshooting

- **"Base image cluster is not built yet"**: run `./cka images build`.
- **"The IP of worker-1 changed ..."**: the Multipass DHCP lease changed, and the cluster certificates are bound to the old address. Rebuild with `./cka images build --force`.
- **Tart: "SSH to worker-1 did not come up"** or **"did not get an IP address"**: check `~/.cka-lab/logs/tart-<node>.log` and `tart list`. A VM left running by another process blocks `tart run`; `tart stop <vm>` it, then reset.
- **Tart: "driver key ... is missing"**: the images were built under another account or `CKA_LAB_HOME`. Rebuild with `./cka images build --driver tart --force`.
- **A session stuck in provisioning after a crash**: restarting the API marks it failed. Then press Reset or End, or run `./cka end`.
- **"Floci is not reachable at http://localhost:4566"**: start Docker, then `floci start`, then press Reset. `floci status` and `floci doctor` diagnose it.
- **An RDS question takes a minute to set up the first time**: Floci is pulling the MySQL image. Later starts take about a second.
- **The AWS terminal says it needs python3**: install the Xcode command line tools (`xcode-select --install`).
- **Restore is slow**: both backends boot the VMs on every reset (`multipass restore` needs stopped instances; Tart clones stopped golden VMs). The time for each reset is in the log (`snapshot restored`, `seconds`).
