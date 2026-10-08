# Session 20: Monitoring, Observability and GitOps

**Submitted by:** Rashi
**Roll No:** 10389
**Batch:** B

Everything was run on macOS with kind (Kubernetes v1.37), Docker Compose, Prometheus v3.5,
Grafana 12.1 and Argo CD v3.5. Lab files: [session20-monitoring-observability-gitops](../../session20-monitoring-observability-gitops/).

- **GitOps repository watched by Argo CD:** https://github.com/RashiMalik02/gitops-demo

## 1. Monitoring vs Observability

| Monitoring | Observability |
|---|---|
| Watches **known** problems with predefined checks and thresholds | Lets you investigate **unknown** problems from the data the system emits |
| Answers "is it working?" | Answers "why is it not working?" |
| Dashboards and alerts (CPU > 80%, error rate, target down) | Explore metrics, logs and traces together and correlate them |

## 2. Metrics, Logs and Traces

| Pillar | What it is | Example | Common tools |
|---|---|---|---|
| Metrics | Numbers measured over time | CPU 80%, 200 requests/s, `up = 1` | Prometheus, Grafana, metrics-server |
| Logs | Timestamped event messages | `Health check OK` | `kubectl logs`, Loki, ELK/EFK |
| Traces | The path of one request across services | API → auth → database, with timings | OpenTelemetry, Jaeger, Tempo |

**Why observability is needed:** in microservices on Kubernetes a single request crosses many Pods
that come and go, so you can't SSH into "the server" to find a bug. Metrics show *that*
something is wrong, logs show *what* happened, traces show *where* in the chain it happened.

**Kubernetes observability:** metrics-server (`kubectl top`), Prometheus scraping
`/metrics` endpoints, `kubectl logs` / `describe` / events for logs and state, and probes for
application health.

### Demo App on a kind Cluster

![kind cluster and demo app](./Screenshots/img_1.png)

### Logs and Describe

The app writes a log line every 10 seconds (`Request received`, `Health check OK`); `describe`
shows the deployment state and events.

![logs and describe](./Screenshots/img_2.png)

### Clean Up

![cleanup](./Screenshots/img_3.png)

## 3. Prometheus

Prometheus **pulls** (scrapes) metrics from targets every `scrape_interval` (5s here), stores
them as time series and answers queries in **PromQL**. `up = 1` means the target was reachable on
the last scrape. Alerts are PromQL expressions with a threshold, e.g. `up == 0 for 1m`.

### Start Prometheus

![prometheus up](./Screenshots/img_4.png)

### Querying `up`

![up query](./Screenshots/img_5.png)

![targets page](./Screenshots/img_5b.png)

### Stop

![stop prometheus](./Screenshots/img_6.png)

## 4. Grafana

Grafana doesn't store metrics. It reads them from a data source such as Prometheus and draws
dashboards. Inside Docker Compose, Grafana reaches Prometheus by its service name,
`http://prometheus:9090`, not `localhost`.

### Start Prometheus and Grafana

![compose up](./Screenshots/img_7.png)

### Prometheus Data Source

Added through **Connections → Data sources → Prometheus** with URL `http://prometheus:9090`.
"Save & test" returned **Successfully queried the Prometheus API**.

![datasource](./Screenshots/img_8.png)

![datasource save and test](./Screenshots/img_8b.png)

### Dashboard

My dashboard covers the monitoring items from the task: **application health** (`up`),
**CPU utilization** (`rate(process_cpu_seconds_total[1m])`), **memory utilization**
(`process_resident_memory_bytes`), **request rate** per handler and the number of series in the
TSDB.

![grafana dashboard](./Screenshots/img_9.png)

### Stop

![stop compose](./Screenshots/img_10.png)

## 5. Introduction to GitOps

| Traditional (push) | GitOps (pull) |
|---|---|
| An engineer runs `kubectl apply` | A controller in the cluster applies what is in Git |
| The cluster drifts from any record (a manual `kubectl scale` is never recorded) | Git is the desired state; drift is detected and corrected |
| Hard to audit or roll back | Every change is a reviewed, revertible commit |

The screenshot shows the problem GitOps solves: after a manual `kubectl scale --replicas=4` the
cluster says 4 while the YAML still says 2, and nothing notices.

![imperative way](./Screenshots/img_11.png)

## 6. Git as Source of Truth

GitOps principles: **declarative** configuration, stored **in Git** (versioned and immutable
history), **pulled** automatically by an agent, and **continuously reconciled**. Changing the
desired state means changing a file and committing it, not editing the cluster.

### Creating the Repository

![git init and first commit](./Screenshots/img_12.png)

### Changing the Desired State

![replicas change commit](./Screenshots/img_13.png)

## 7. Argo CD

Argo CD runs inside the cluster, watches a Git repository and keeps the cluster in sync with it.
`prune: true` deletes what was removed from Git, `selfHeal: true` undoes manual changes.

```text
git push -> GitHub -> Argo CD detects the new commit -> Kubernetes updated
```

The manifests are in https://github.com/RashiMalik02/gitops-demo (folder `07-argocd/app`); the
Application manifest is in `argocd/`, outside the synced path.

### Cluster

![kind cluster](./Screenshots/img_14.png)

### Installing Argo CD

![argocd install](./Screenshots/img_15a.png)

![argocd pods and login](./Screenshots/img_15b.png)

### Argo CD UI

Port 8080 was already used on my machine, so I forwarded the UI to 8443.

![argocd ui](./Screenshots/img_16.png)

### Registering the Application

![push repo and apply application](./Screenshots/img_17.png)

### Synced Application

![argocd app tree](./Screenshots/img_18.png)

![synced and healthy](./Screenshots/img_18b.png)

### The Running App

![running app](./Screenshots/img_19.png)

### Scaling to 2 by Git Push

I only edited the YAML and pushed. About 3 minutes later (Argo CD's polling interval) the
Deployment went from 5 to 2 replicas without any `kubectl` command.

![scale to 2](./Screenshots/img_20.png)

### Scaling to 3 by Git Push

Second commit pushed, and Argo CD applied it on a later poll the same way. Its sync history lines
up with the Git log: every sync is one commit, deployed a few minutes after it was pushed
(commit times are in IST, sync times in UTC).

![scale to 3](./Screenshots/img_21.png)

![argocd after sync](./Screenshots/img_21b.png)

### Clean Up

Deleting the Application did **not** delete the Deployment and Service it created. The
Application has no `resources-finalizer.argocd.argoproj.io` finalizer, so Argo CD just stops
managing them. I removed them by deleting the namespace. With the finalizer, deleting the
Application would also delete everything it deployed.

![cleanup](./Screenshots/img_22.png)

## 8. Mini Project

Namespace, Deployment (2 replicas) and Service deployed only through Argo CD from
https://github.com/RashiMalik02/gitops-demo (folder `08-mini-project/app`, Application
`argocd/session20-mini.yaml`).

```text
Git (desired state) -> Argo CD (reconciler) -> Kubernetes (actual state)
```

### Cluster and Argo CD

I reused the same `session20` kind cluster from section 7, which already had Argo CD installed.

![cluster and argocd](./Screenshots/img_23.png)

### Application Synced

After applying the Application it stayed at `Unknown` and nothing was created.

![application applied](./Screenshots/img_24.png)

**Troubleshooting:** the Application's condition was a `ComparisonError`. The repo-server couldn't
reach GitHub because the DNS lookup for `github.com` timed out. CoreDNS's logs showed *its*
upstream (Docker Desktop's DNS at 192.168.65.254) timing out, so the problem was outside the
cluster, not in Argo CD. A test Pod could resolve `github.com` again a minute later, so it was a
transient upstream timeout. Instead of waiting for the next poll, I asked Argo CD to retry with
the `argocd.argoproj.io/refresh=hard` annotation, and it synced straight away.

![dns troubleshooting](./Screenshots/img_24b.png)

![synced resources](./Screenshots/img_24c.png)

![argocd mini app tree](./Screenshots/img_24d.png)

### Git Change: 3 Replicas

Changed `replicas: 2` → `3` in `08-mini-project/app/deployment.yaml`, committed and pushed.
About 5 minutes later Argo CD synced commit `90450cf` and the Deployment went to 3/3. No `kubectl`
was involved.

![git change to 3 replicas](./Screenshots/img_25.png)

### Self-Healing

A manual `kubectl scale --replicas=1` was reverted by Argo CD back to 3 within about a second,
because `selfHeal: true` treats the live cluster differing from Git as drift. The events show the
scale-down to 1 and the immediate scale-up to 3. The only way to really change the replica count
is to change Git.

![self healing](./Screenshots/img_26.png)

### Observing the System

Three healthy Pods serving requests (nginx access log), the Application `Synced`/`Healthy`, its
sync history (one entry per Git commit), and every managed resource marked `Synced`.

![observing](./Screenshots/img_27.png)

![argocd final state](./Screenshots/img_27b.png)

### Clean Up

![cleanup mini project](./Screenshots/img_28.png)

## Key Learnings

- **Metrics, logs and traces** together make a system observable.
- **Prometheus** collects metrics, **Grafana** visualises them; alerts are PromQL with a threshold.
- In **GitOps**, Git is the single source of truth: changes are commits, not `kubectl` commands.
- **Argo CD** pulls from Git, applies the changes and self-heals manual drift.
