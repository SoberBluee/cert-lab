# Setup

## Requirements

- macOS on Apple Silicon (or any host Multipass supports) with **Multipass 1.13+**, which is needed for snapshots
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

1. launches 3 Ubuntu VMs and installs containerd, kubeadm, kubelet and kubectl at the version pinned in `config/versions.yaml`, then snapshots **`bare`**;
2. runs `kubeadm init`, installs Calico, joins the workers, waits for everything to be Ready, then snapshots **`cluster`**;
3. writes `~/.cka-lab/images.json` (build date, versions, node IPs) and leaves the VMs stopped.

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
- It needs the Multipass driver; with `CKA_DRIVER=fake` it only prints a notice.
- The browser closes the tab on Cmd/Ctrl+W, so the page asks for confirmation before leaving while a terminal is connected.

## Files and state

| Path | What |
| --- | --- |
| `~/.cka-lab/state.db` | SQLite: sessions, attempts, check results |
| `~/.cka-lab/logs/orchestrator.log` | every orchestrator operation (JSON lines) |
| `~/.cka-lab/keys/session` | per-session SSH key |
| `~/.cka-lab/session/kubeconfig` | admin kubeconfig of the running lab |
| `~/.cka-lab/images.json` | base image metadata, written by the build |

Set `CKA_LAB_HOME` to move this directory. Nothing in it belongs in git.

## Developing without VMs

`CKA_DRIVER=fake npm run dev` runs the API against a simulated lab. Provisioning steps are faked, and every command returns empty output, so most checks fail. It uses a separate `state-fake.db`, which keeps fake attempts out of your real history.

## Troubleshooting

- **"Base image cluster is not built yet"**: run `./cka images build`.
- **"The IP of worker-1 changed ..."**: the Multipass DHCP lease changed, and the cluster certificates are bound to the old address. Rebuild with `./cka images build --force`.
- **A session stuck in provisioning after a crash**: restarting the API marks it failed. Then press Reset or End, or run `./cka end`.
- **Restore is slow**: `multipass restore` needs stopped instances, so every reset includes a full boot. The time for each reset is in the log (`snapshot restored`, `seconds`).
