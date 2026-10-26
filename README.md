# Cert Lab: free, hands-on practice labs for IT certifications

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Kubernetes 1.37](https://img.shields.io/badge/kubernetes-1.37-326ce5?logo=kubernetes&logoColor=white)](config/versions.yaml)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey?logo=apple)](docs/setup.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](#contributing)

Practise for IT certifications by doing the work, on real infrastructure that runs on your own machine: a **3-node Kubernetes cluster** for the **CKA**, Linux nodes for the commands every admin needs, and a local AWS emulator for the **AWS Solutions Architect Associate**. Each lab breaks something or gives you something to build, then grades the end state the way the exams do. It is free and open source: no cloud account, no subscription, no time limit, and a clean environment again in seconds.

<!--
  A demo image helps people decide in seconds. Record a lab being broken, fixed and graded
  (Cmd+Shift+5 on macOS), save it as docs/images/demo.gif, and uncomment:
  ![A broken Kubernetes node, the browser terminal and the grade in Cert Lab](docs/images/demo.gif)
-->

## Tracks

| Track | Prepares you for | What is in it | Status |
| --- | --- | --- | --- |
| [Kubernetes](#kubernetes-cka) | Certified Kubernetes Administrator (CKA) | 150 scenarios, a lab generator with 209 faults, full mock exams, 15 guided lessons, 7 quizzes | Ready |
| [Linux](#linux) | The Linux side of the CKA and of everyday operations | 7 guided lessons on real nodes, an openssl quiz | Ready |
| [AWS](#aws) | AWS Solutions Architect Associate (SAA-C03) | 10 scenarios across the four exam domains, on a local AWS emulator | Ready |
| [System Labs](#system-labs) | Networking and system design fundamentals | 8 interactive topics, from IP and DNS to load balancing, caching and CDNs | In progress |
| Terraform | Terraform Associate | | Planned |
| Docker | Docker skills and certification | | Planned |

## Why use it

- **Real infrastructure, not a simulation.** Kubernetes runs as a real kubeadm cluster in VMs, and AWS labs run real AWS CLI calls against a local emulator. When a task breaks the kubelet or etcd, it really is broken.
- **Exam-style tasks, graded on outcomes.** Tasks state the symptom and the end state, never the cause. Checks inspect the live environment, not the commands you typed, so any valid fix passes.
- **Practice that does not run out.** Names, namespaces and the injected fault are rolled again on every start, and a lab generator builds new questions, so repeating a lab never means repeating the answer.
- **Exam conditions when you want them.** Exam mode gives a countdown, no hints and one submit at the end, then a review of every point you lost.
- **Know what to study next.** History records every attempt and the minutes each question took; the Focus tab turns that into your weakest topics.
- **Unlimited resets.** Every start or reset restores a clean environment, so breaking things costs nothing.
- **Your way in.** A web UI with a browser terminal, or the `./cka` command line with your own terminal.

## Kubernetes (CKA)

A kubeadm-built Kubernetes 1.37 cluster on Ubuntu 24.04: one control plane and two workers, with Calico, Traefik (Ingress and Gateway API), Helm, metrics-server and the Vertical Pod Autoscaler.

- **150 scenarios** and **Quick lab**, a generator that builds new questions from 26 build-task recipes and 209 faults in 23 troubleshooting categories, up to three faults stacked in one question.
- **Full mock exams:** 17 questions weighted like the CKA curriculum, a fixed 120-minute timer and a kubeconfig context per question.
- **Focus** scores every topic from your own attempts (attempts without hints count most), compares your minutes per question with exam pace, and builds a lab from your weak spots.
- **Guided lessons** walk you through etcd, certificates, Jobs and CronJobs, admission control and layer-by-layer debugging on the live cluster, with questions along the way; **quizzes** drill error messages, paths, workloads, networking, storage, RBAC and cluster architecture.

Every domain of the [CKA curriculum](https://github.com/cncf/curriculum) is covered, weighted like the exam:

| CKA domain | Weight | Examples |
| --- | --- | --- |
| Troubleshooting | 30% | NotReady nodes and failing kubelets, broken control plane static Pods and etcd, CoreDNS, Services and kube-proxy, NetworkPolicies, Pods that crash, never start or are refused at admission |
| Cluster architecture, installation and configuration | 25% | kubeadm install and upgrade, etcd backup and restore, certificates and CSRs, RBAC, Helm, Kustomize, CRDs and operators |
| Services and networking | 20% | Services, Ingress, Gateway API with HTTPRoutes and TLS, NetworkPolicies, CoreDNS |
| Workloads and scheduling | 15% | Deployments and rollouts, Jobs and CronJobs, HPA and VPA autoscaling, probes, scheduling, resource limits |
| Storage | 10% | PersistentVolumes and claims, StorageClasses, dynamic provisioning |

## Linux

Guided command drills on the lab's real Ubuntu nodes: files and text processing, ufw and iptables, node networking (ip, ss, curl, DNS lookups, sysctl), openssl from scratch to certificate chains, and systemd and journald. Each step turns green once you have run it; Drill mode hides the commands so you type them from memory.

## AWS

Scenarios for the **AWS Solutions Architect Associate (SAA-C03)**, grouped by its four domains: secure, resilient, high-performing and cost-optimized architectures. You solve them with the AWS CLI against [Floci](https://github.com/floci-io/floci), an AWS emulator running in Docker on your machine. Every attempt gets a fresh, empty account in seconds, and no AWS account is involved, so nothing is billed.

## System Labs

Interactive lessons on the fundamentals behind every infrastructure exam: IP addressing and routing, the OSI model, TCP and UDP, DNS, load balancing, caching, CDNs and proxies. Each topic explains the idea, then lets you run it in a simulation.

## Quick start

Requirements: macOS (Apple Silicon recommended), Node.js 22.13+, and [Multipass](https://multipass.run) 1.13+ or [Tart](https://tart.run) for the Kubernetes and Linux labs. A running cluster needs about 6 GB of RAM and 60 GB of disk. The AWS labs need Docker and Floci instead.

```bash
git clone https://github.com/SoberBluee/cert-lab.git && cd cert-lab
npm install
./cka images build          # once, 15-25 minutes: builds the Kubernetes VMs and their snapshots
npm run dev                 # API on :4317, UI on http://localhost:5173
```

Open http://localhost:5173, pick a scenario and press **Start**, or press **Start** in the Quick lab bar for a random lab. Switch tracks from the logo menu. [docs/setup.md](docs/setup.md) covers installation, the VM backends, the AWS emulator and troubleshooting.

## How it works

1. A start restores a clean environment: a snapshot of the cluster, or a new empty AWS account.
2. The scenario's setup breaks something, or prepares the starting point for something to build.
3. You work in the browser terminal or your own, with the shortcuts the exams allow.
4. Grading runs checks against the live environment: each one passes or fails, with its points.
5. Reset or start again, and the next attempt rolls new names and faults.

## Documentation

| Guide | What is in it |
| --- | --- |
| [User guide](docs/guide.md) | Every feature in detail: sessions, exam mode, Quick lab, Full mock, lessons, Focus, the Studio, the recipe and fault catalog, AWS labs, the command line, the architecture |
| [Setup](docs/setup.md) | Installation, image builds, VM backends, the AWS emulator, troubleshooting |
| [Authoring](docs/authoring.md) | Writing your own scenarios, lessons and fault recipes |

## FAQ

**Is it really free?** Yes. It is MIT-licensed and runs entirely on your machine.

**Do I need a cloud account or a paid lab?** No. Kubernetes and Linux run in local VMs, and the AWS labs use a local emulator with throwaway accounts.

**Does it run on Linux or Windows?** It is built and tested on macOS. Multipass also runs on Linux and Windows, but the lab is untested there; reports and fixes are welcome.

**Does it contain real exam questions?** No. Every scenario is written from the public exam curricula. Nothing comes from a real exam or from paid practice tests.

**How does it compare with killer.sh?** Use both. The killer.sh simulator that comes with a CKA registration is the closest to the real exam's interface. Cert Lab adds unlimited, randomized practice on a real cluster you control, between those sessions.

**Which Kubernetes version?** 1.37, pinned in [config/versions.yaml](config/versions.yaml) together with 1.36 for upgrade practice.

**When are Terraform and Docker coming?** They are planned. Contributions are very welcome, see below.

## Contributing

Scenarios, lessons and quiz questions are YAML and shell, so you need no TypeScript to add one: see [docs/authoring.md](docs/authoring.md). Run `./cka lint` and `npm test` before opening a pull request, and prove a new Kubernetes scenario with `./cka dry-run <id>` (every check fails before the fix) and `./cka verify <id>` (every check passes after it). New tracks, such as Terraform and Docker, are especially welcome. Bug reports and ideas go in the issues.

## License and disclaimer

[MIT](LICENSE).

Certification names are trademarks of their owners: CKA and Certified Kubernetes Administrator of The Linux Foundation, AWS of Amazon Web Services, Terraform of HashiCorp and Docker of Docker, Inc. This project is not affiliated with or endorsed by any of them, nor by killer.sh or KodeKloud, and it contains no real exam questions.
