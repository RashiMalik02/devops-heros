# Session 10 — Kubernetes Core Objects and Deployment Strategies

**Submitted by:** Rashi
**Enrollment / Roll No:** 10389
**Batch:** B

I ran everything on macOS against a local `kind` cluster (Kubernetes v1.37.0, kind v0.33.0), inside
a `session10-lab` namespace so I could delete the whole lot at the end in one command.

```console
$ kubectl create namespace session10-lab
namespace/session10-lab created
```

---

## Folder Guide

| Folder | Covers |
| :--- | :--- |
| [pod/](pod/) | Pod — the smallest thing you can deploy |
| [replicaset/](replicaset/) | ReplicaSet — keeps N copies alive |
| [deployment/](deployment/) | Deployment — manages ReplicaSets for you |
| [daemonset/](daemonset/) | DaemonSet — one pod per node |
| [pod-lifecycle/](pod-lifecycle/) | All the pod states and the probe types |
| [01-rolling-update/](01-rolling-update/) | Zero-downtime rolling update |
| [02-blue-green/](02-blue-green/) | Instant switch by changing a Service selector |
| [03-canary/](03-canary/) | Gradual shift using two Deployments behind one Service |
| [04-recreate/](04-recreate/) | All-at-once redeploy, with downtime |
| [troubleshooting/](troubleshooting/) | Broken image and selector mismatch drills |

---

## Task 1: Core Objects

```console
$ kubectl apply -n session10-lab -f pod/nginx-pod.yaml -f replicaset/backend-rs.yaml -f daemonset/node-agent-ds.yaml
pod/yatri-demo-pod created
replicaset.apps/yatri-backend-rs created
daemonset.apps/node-logging-agent created

$ kubectl get pods,rs,daemonset -n session10-lab
NAME                           READY   STATUS    RESTARTS   AGE
pod/node-logging-agent-rjk95   1/1     Running   0          68s
pod/yatri-backend-rs-8g62w     1/1     Running   0          14s
pod/yatri-backend-rs-bm6mq     1/1     Running   0          14s
pod/yatri-backend-rs-k55xg     1/1     Running   0          14s
pod/yatri-demo-pod             1/1     Running   0          68s

NAME                               DESIRED   CURRENT   READY   AGE
replicaset.apps/yatri-backend-rs   3         3         3       14s

NAME                                DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR   AGE
daemonset.apps/node-logging-agent   1         1         1       1            1           <none>          68s
```

The DaemonSet says `DESIRED 1` because my cluster only has one node. On a three-node cluster it'd
say 3, and I wouldn't have to change anything in the manifest for that to happen.

```console
$ kubectl logs -n session10-lab -l app=node-logging-agent --tail=3
[Thu Sep 17 18:19:07 UTC 2026] Collecting host system metrics on node-logging-agent-rjk95
```

### Checking the ReplicaSet actually replaces pods

I deleted one of the three by hand to see what would happen:

```console
$ kubectl delete pod yatri-backend-rs-8g62w -n session10-lab
pod "yatri-backend-rs-8g62w" deleted from session10-lab namespace

$ kubectl get pods -l app=yatri-backend -n session10-lab
NAME                     READY   STATUS    RESTARTS   AGE
yatri-backend-rs-bcqln   1/1     Running   0          31s
yatri-backend-rs-bm6mq   1/1     Running   0          48s
yatri-backend-rs-k55xg   1/1     Running   0          48s
```

Still three. `bcqln` is a brand new pod with a new name, not the old one coming back. The ReplicaSet
noticed the count had dropped and just made another one.

### Deployment

```console
$ kubectl apply -n session10-lab -f deployment/deployment-v1.yaml
deployment.apps/yatri-backend created

$ kubectl get deployment,rs,pods -l app=yatri-backend -n session10-lab
NAME                            READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/yatri-backend   3/3     3            3           4s

NAME                                       DESIRED   CURRENT   READY   AGE
replicaset.apps/yatri-backend-7554bd5c75   3         3         3       4s

NAME                                 READY   STATUS    RESTARTS   AGE
pod/yatri-backend-7554bd5c75-5mz6r   1/1     Running   0          4s
pod/yatri-backend-7554bd5c75-cjcq7   1/1     Running   0          4s
pod/yatri-backend-7554bd5c75-rmrnh   1/1     Running   0          4s
```

The Deployment didn't make pods itself. It made a ReplicaSet named after a hash of the pod template
(`7554bd5c75`), and that ReplicaSet made the pods. That hash turns out to be the thing that makes
rolling updates and rollbacks work later on, which I didn't appreciate until Task 3.

```console
$ kubectl describe deployment yatri-backend -n session10-lab
StrategyType:           RollingUpdate
MinReadySeconds:        0
RollingUpdateStrategy:  1 max unavailable, 1 max surge
```

### A conflict I ran into

Applying `replicaset/backend-rs.yaml` and `deployment/deployment-v1.yaml` together doesn't work, and
working out why was probably the most useful thing in this task.

Both of them use the selector `app: yatri-backend`. The Deployment controller looked at my
standalone ReplicaSet, decided it was one of *its own* old ReplicaSets, and scaled it to zero:

```console
$ kubectl get rs -n session10-lab
NAME                                       DESIRED   CURRENT   READY   AGE
replicaset.apps/yatri-backend-7554bd5c75   3         3         3       30s
replicaset.apps/yatri-backend-rs           0         0         0       30s

$ kubectl describe rs yatri-backend-rs -n session10-lab
Events:
  Type    Reason            Age   From                   Message
  ----    ------            ----  ----                   -------
  Normal  SuccessfulCreate  30s   replicaset-controller  Created pod: yatri-backend-rs-swzpm
  Normal  SuccessfulDelete  2s    replicaset-controller  Deleted pod: yatri-backend-rs-khtcw
  Normal  SuccessfulDelete  1s    replicaset-controller  Deleted pod: yatri-backend-rs-swzpm
```

It created three pods and then deleted them again seconds later, which looked like a bug until I
worked out what was going on. Deleting the Deployment afterwards also took the adopted ReplicaSet
with it. I ended up running the two separately. The lesson is that ownership in Kubernetes is
decided by label selectors and not by names, so two controllers pointed at the same labels will
fight over the same pods.

---

## Task 2: Pod Lifecycle

```console
$ kubectl apply -n session10-lab -f 01-running.yaml -f 02-pending.yaml -f 03-succeeded.yaml \
    -f 04-failed.yaml -f 05-crashloopbackoff.yaml -f 06-imagepullbackoff.yaml
pod/lifecycle-running created
pod/lifecycle-pending created
pod/lifecycle-succeeded created
pod/lifecycle-failed created
pod/lifecycle-crashloop created
pod/lifecycle-image-error created
```

All six states at once, plus the probe and multi-container ones:

```console
$ kubectl get pods -n session10-lab
lifecycle-crashloop         0/1   CrashLoopBackOff   4 (70s ago)   2m48s
lifecycle-failed            0/1   Error              0             2m48s
lifecycle-image-error       0/1   ImagePullBackOff   0             2m48s
lifecycle-init              1/1   Running            0             24s
lifecycle-liveness          1/1   Running            0             24s
lifecycle-multi-container   2/2   Running            0             24s
lifecycle-pending           0/1   Pending            0             2m48s
lifecycle-readiness         1/1   Running            0             24s
lifecycle-running           1/1   Running            0             2m48s
lifecycle-succeeded         0/1   Completed          0             2m48s
```

### STATUS isn't the phase

I'd assumed the `STATUS` column was the pod's phase. It isn't. Asking for the phase directly gives
something different:

```console
$ kubectl get pods -n session10-lab -o custom-columns=NAME:.metadata.name,PHASE:.status.phase
NAME                        PHASE
lifecycle-crashloop         Running
lifecycle-failed            Failed
lifecycle-image-error       Pending
lifecycle-init              Running
lifecycle-multi-container   Running
lifecycle-pending           Pending
lifecycle-readiness         Running
lifecycle-running           Running
lifecycle-succeeded         Succeeded
```

There are only five real phases: Pending, Running, Succeeded, Failed, Unknown. `CrashLoopBackOff` is
a container-level waiting reason inside a pod whose phase is still `Running`, and `ImagePullBackOff`
sits inside phase `Pending`. The `STATUS` column mashes the two levels together to be helpful, which
is fine until you try to script against it.

### Why each one is in the state it's in

`lifecycle-pending` asks for 9Gi of memory, which nothing can give it:

```console
$ kubectl describe pod lifecycle-pending -n session10-lab
Events:
  Type     Reason            Age                 From               Message
  ----     ------            ----                ----               -------
  Warning  FailedScheduling  2m (x6 over 2m20s)  default-scheduler  0/1 nodes are available: 1 Insufficient memory. preemption: 0/1 nodes are available: 1 Preemption is not helpful for scheduling.
```

It's stuck before it ever gets scheduled, so it has no node and no IP at all.

`lifecycle-succeeded` and `lifecycle-failed` run the same container and only differ in exit code:

```console
$ kubectl logs lifecycle-succeeded -n session10-lab
Task started
Task completed successfully

$ kubectl logs lifecycle-failed -n session10-lab
Task started
Task failed
```

Exit 0 gives you `Succeeded`, exit 1 gives you `Failed`. Both have `restartPolicy: Never`, which is
what lets them stay dead instead of being restarted.

`lifecycle-crashloop` starts fine and then exits, again and again:

```console
$ kubectl logs lifecycle-crashloop -n session10-lab
Application started
Application crashed

$ kubectl get pod lifecycle-crashloop -n session10-lab
lifecycle-crashloop   0/1   CrashLoopBackOff   4 (70s ago)   2m24s
```

It sat on `Error` for a while before it said `CrashLoopBackOff`, which confused me. It took roughly
two minutes. The kubelet backs off exponentially (10s, 20s, 40s and so on) and only reports the
backoff once the waiting actually starts, so early on you just see it failing repeatedly.

`lifecycle-image-error` points at an image that doesn't exist:

```console
$ kubectl describe pod lifecycle-image-error -n session10-lab
  Normal   Pulling    24s (x4 over 2m20s)  kubelet  Pulling image "jakwehrgkaejw:kahsdfgkhj"
  Warning  Failed     22s (x3 over 2m14s)  kubelet  Failed to pull image "jakwehrgkaejw:kahsdfgkhj": pull access denied, repository does not exist or may require authorization
  Warning  Failed     22s (x4 over 2m14s)  kubelet  Error: ErrImagePull
  Normal   BackOff    11s (x6 over 2m13s)  kubelet  Back-off pulling image "jakwehrgkaejw:kahsdfgkhj"
```

### Init containers and sidecars

```console
$ kubectl logs lifecycle-init -c setup -n session10-lab
Init container running
Init complete
```

The init container runs all the way through before the app container starts at all. The main
container only began once `setup` had exited cleanly.

```console
$ kubectl get pod lifecycle-multi-container -n session10-lab -o jsonpath='{range .spec.containers[*]}{.name}{"\n"}{end}'
app
sidecar

$ kubectl logs lifecycle-multi-container -c sidecar -n session10-lab --tail=3
Sidecar is running
Sidecar is running
Sidecar is running
```

This pod shows `READY 2/2` while the single-container ones show `1/1`. So that column is counting
containers, not pods, which I hadn't registered before.

```console
$ kubectl describe pod lifecycle-readiness -n session10-lab
    Readiness:      http-get http://:80/ delay=5s timeout=1s period=5s successThreshold=1 failureThreshold=3
```

More detail per state in [pod-lifecycle/README.md](pod-lifecycle/README.md).

---

## Task 3: Rolling Update

[01-rolling-update/deployment-v1.yaml](01-rolling-update/deployment-v1.yaml) sets `maxSurge: 1` and
`maxUnavailable: 0`. One extra pod allowed during the update, and no existing pod may be taken away
until its replacement is ready.

```console
$ kubectl apply -n session10-lab -f 01-rolling-update/deployment-v1.yaml -f 01-rolling-update/service.yaml
deployment.apps/app-rolling created
service/app-rolling-service created

$ kubectl get pods -l app=app-rolling -n session10-lab -L version
NAME                           READY   STATUS    RESTARTS   AGE   VERSION
app-rolling-86d7d44d5b-5mjg8   1/1     Running   0          27s   v1
app-rolling-86d7d44d5b-8m45x   1/1     Running   0          27s   v1
app-rolling-86d7d44d5b-khh86   1/1     Running   0          27s   v1
app-rolling-86d7d44d5b-lnrk9   1/1     Running   0          27s   v1
```

Then switching to v2 and checking every four seconds to see it happen:

```console
$ kubectl apply -n session10-lab -f 01-rolling-update/deployment-v2.yaml
deployment.apps/app-rolling configured

--- t+1 ---
app-rolling-56bff6d88c-2485r 0/1 ContainerCreating v2
app-rolling-86d7d44d5b-5mjg8 1/1 Running           v1
app-rolling-86d7d44d5b-8m45x 1/1 Running           v1
app-rolling-86d7d44d5b-khh86 1/1 Running           v1
app-rolling-86d7d44d5b-lnrk9 1/1 Running           v1
--- t+3 ---
app-rolling-56bff6d88c-2485r 1/1 Running           v2
app-rolling-56bff6d88c-b85bt 0/1 Running           v2
app-rolling-86d7d44d5b-5mjg8 1/1 Running           v1
app-rolling-86d7d44d5b-khh86 1/1 Running           v1
app-rolling-86d7d44d5b-lnrk9 1/1 Running           v1
--- t+5 ---
app-rolling-56bff6d88c-2485r 1/1 Running           v2
app-rolling-56bff6d88c-b85bt 1/1 Running           v2
app-rolling-56bff6d88c-j7nvz 0/1 Running           v2
app-rolling-86d7d44d5b-5mjg8 1/1 Running           v1
app-rolling-86d7d44d5b-khh86 1/1 Running           v1
--- t+6 ---
app-rolling-56bff6d88c-2485r 1/1 Running           v2
app-rolling-56bff6d88c-8qtpr 0/1 Running           v2
app-rolling-56bff6d88c-b85bt 1/1 Running           v2
app-rolling-56bff6d88c-j7nvz 1/1 Running           v2
app-rolling-86d7d44d5b-khh86 1/1 Running           v1
```

At `t+1` there are five pods, not four. That's the surge pod. Counting the `1/1 Running` lines at
every step, it never drops below four, which is exactly what `maxUnavailable: 0` is promising. A new
pod only turns up after the one before it reports ready.

Two ReplicaSets exist now, with the old one sitting at zero:

```console
$ kubectl get rs -l app=app-rolling -n session10-lab
NAME                     DESIRED   CURRENT   READY   AGE
app-rolling-56bff6d88c   4         4         4       29s
app-rolling-86d7d44d5b   0         0         0       59s

$ kubectl rollout history deployment/app-rolling -n session10-lab
REVISION  CHANGE-CAUSE
1         <none>
2         <none>
```

That empty old ReplicaSet is the whole trick behind rollback. Undoing just scales it back up:

```console
$ kubectl rollout undo deployment/app-rolling -n session10-lab
deployment.apps/app-rolling rolled back

$ kubectl get pods -l app=app-rolling -n session10-lab -L version
NAME                           READY   STATUS        RESTARTS   AGE   VERSION
app-rolling-56bff6d88c-2485r   1/1     Terminating   0          56s   v2
app-rolling-86d7d44d5b-67x6l   1/1     Running       0          6s    v1
app-rolling-86d7d44d5b-llxpx   1/1     Running       0          18s   v1
app-rolling-86d7d44d5b-n2785   1/1     Running       0          12s   v1
app-rolling-86d7d44d5b-pfxc4   1/1     Running       0          24s   v1
```

`CHANGE-CAUSE` is `<none>` for both revisions because I used plain `kubectl apply`. Setting a
`kubernetes.io/change-cause` annotation would fill that in and make the history worth reading, which
I'll do next time.

---

## Task 4: Blue-Green Deployment

Both versions run at once here, told apart by a `slot` label:

```console
$ kubectl apply -n session10-lab -f 02-blue-green/deployment-blue.yaml -f 02-blue-green/deployment-green.yaml -f 02-blue-green/service-blue.yaml
deployment.apps/app-blue created
deployment.apps/app-green created
service/myapp-service created

$ kubectl get pods -l app=myapp -n session10-lab -L slot,version
NAME                        READY   STATUS    RESTARTS   AGE   SLOT    VERSION
app-blue-5c69d7785c-n489q   1/1     Running   0          9s    blue    v1
app-blue-5c69d7785c-rpxh5   1/1     Running   0          9s    blue    v1
app-blue-5c69d7785c-wc6l9   1/1     Running   0          9s    blue    v1
app-green-84df7f978-6qngb   1/1     Running   0          9s    green   v2
app-green-84df7f978-hz5q7   1/1     Running   0          9s    green   v2
app-green-84df7f978-pt9m2   1/1     Running   0          9s    green   v2
```

Six pods up, but the Service only points at blue:

```console
$ kubectl describe svc myapp-service -n session10-lab
Selector:                 app=myapp,slot=blue
Endpoints:                10.244.0.44:80,10.244.0.46:80,10.244.0.45:80
```

I wrote down which IPs belonged to which colour first, otherwise there's no way to prove the switch
really did anything:

```console
BLUE pod IPs:   10.244.0.44  10.244.0.45  10.244.0.46
GREEN pod IPs:  10.244.0.47  10.244.0.48  10.244.0.49
```

The switch itself is one word in one field, `slot: blue` to `slot: green`:

```console
$ kubectl apply -n session10-lab -f 02-blue-green/service-green.yaml
service/myapp-service configured

$ kubectl describe svc myapp-service -n session10-lab
Selector:                 app=myapp,slot=green
Endpoints:                10.244.0.47:80,10.244.0.49:80,10.244.0.48:80
```

The endpoints jumped from the blue set to the green set, and not a single pod was created or
destroyed to make that happen. That's why the cutover is basically instant, and why rolling back is
just editing the selector back to `blue` rather than redeploying anything. The price is running
double the pods for the whole window, which on a real app is double the cost.

---

## Task 5: Canary Deployment

Two Deployments, one Service picking up both through the label they share. The split comes from the
replica counts.

```console
$ kubectl apply -n session10-lab -f 03-canary/deployment-stable.yaml -f 03-canary/deployment-canary.yaml -f 03-canary/service.yaml
deployment.apps/app-stable created
deployment.apps/app-canary created
service/myapp-canary-service created

$ kubectl get pods -l app=myapp-canary -n session10-lab -L track --no-headers | awk '{print $6}' | sort | uniq -c
   1 canary
   9 stable
```

Nine stable to one canary, so about 10% of traffic hits the new version. All ten are endpoints of
the same Service:

```console
$ kubectl get endpointslice -l kubernetes.io/service-name=myapp-canary-service -n session10-lab -o jsonpath='...' | wc -w
      10
```

Pushing the canary up to 30% is just scaling, no redeploy:

```console
$ kubectl scale deployment app-canary --replicas=3 -n session10-lab
deployment.apps/app-canary scaled
$ kubectl scale deployment app-stable --replicas=7 -n session10-lab
deployment.apps/app-stable scaled

$ kubectl get pods -l app=myapp-canary -n session10-lab -L track --no-headers | awk '{print $6}' | sort | uniq -c
   3 canary
   7 stable

$ kubectl get deployment -l app=myapp-canary -n session10-lab
NAME         READY   UP-TO-DATE   AVAILABLE   AGE
app-canary   3/3     3            3           23s
app-stable   7/7     7            7           23s
```

The catch is that the split is only as precise as the pod count lets it be. Ten pods means you can
only move in 10% steps. A 1% canary this way would need a hundred pods, which is presumably why real
setups use an ingress controller or a service mesh and split by weight instead.

---

## Task 6: Recreate Deployment

```console
$ kubectl apply -n session10-lab -f 04-recreate/deployment-v1.yaml -f 04-recreate/service.yaml
deployment.apps/app-recreate created
service/app-recreate-service created

$ kubectl get pods -l app=app-recreate -n session10-lab -L version
app-recreate-6c78cb55bb-65px5   1/1   Running   0   1s   v1
app-recreate-6c78cb55bb-cpsrd   1/1   Running   0   1s   v1
app-recreate-6c78cb55bb-v75tm   1/1   Running   0   1s   v1
```

Switching to v2, sampling every three seconds. I wanted to actually catch the gap rather than take
it on trust:

```console
$ kubectl apply -n session10-lab -f 04-recreate/deployment-v2.yaml
deployment.apps/app-recreate configured

t+1: total=3 running=0
         app-recreate-6c78cb55bb-65px5 Terminating v1
         app-recreate-6c78cb55bb-cpsrd Terminating v1
         app-recreate-6c78cb55bb-v75tm Terminating v1
t+2: total=3 running=3
         app-recreate-7bd8d89b8b-jwm4v Running v2
         app-recreate-7bd8d89b8b-vw62j Running v2
         app-recreate-7bd8d89b8b-wzpd8 Running v2
```

`running=0` at `t+1` is the downtime, caught directly. Every v1 pod was terminating and no v2 pod
existed yet. Next to Task 3, where the ready count never fell below four, the contrast is about as
clear as it gets.

This is the right choice when the two versions genuinely can't run at the same time, like a schema
migration that isn't backwards compatible, or an app that holds an exclusive lock on a volume.

---

## Task 7: Troubleshooting

### Broken image

[troubleshooting/broken-image.yaml](troubleshooting/broken-image.yaml) repoints the `yatri-backend`
Deployment at a tag that doesn't exist.

```console
$ kubectl apply -f troubleshooting/broken-image.yaml -n session10-lab
deployment.apps/yatri-backend configured

$ kubectl get pods -l app=yatri-backend -n session10-lab
yatri-backend-7554bd5c75-5mz6r   1/1   Running        0    6m28s
yatri-backend-7554bd5c75-cjcq7   1/1   Running        0    6m28s
yatri-backend-7554bd5c75-rmrnh   1/1   Running        0    6m28s
yatri-backend-77dbb657cd-h9sk5   0/1   ErrImagePull   0    11s
```

```console
$ kubectl describe pod yatri-backend-77dbb657cd-h9sk5 -n session10-lab
  Warning  Failed  9s (x2 over 26s)  kubelet  Failed to pull image "yatri-backend:non-existent-tag-v999": pull access denied, repository does not exist or may require authorization
  Warning  Failed  9s (x2 over 26s)  kubelet  Error: ErrImagePull
```

The rollout never finishes:

```console
$ kubectl rollout status deployment/yatri-backend -n session10-lab --timeout=20s
Waiting for deployment "yatri-backend" rollout to finish: 1 out of 3 new replicas have been updated...
error: timed out waiting for the condition
```

But the app stayed up the entire time, and that's the bit that matters:

```console
$ kubectl get deployment yatri-backend -n session10-lab
NAME            READY   UP-TO-DATE   AVAILABLE   AGE
yatri-backend   3/3     1            3           6m52s
```

`READY 3/3` and `AVAILABLE 3`, but `UP-TO-DATE 1`. The rolling update wouldn't kill healthy old pods
to make space for a broken new one, so a bad image gave me a stuck deploy rather than an outage. I
found that genuinely reassuring. Getting out of it is one command:

```console
$ kubectl rollout undo deployment/yatri-backend -n session10-lab
deployment.apps/yatri-backend rolled back
deployment "yatri-backend" successfully rolled out
```

### Selector mismatch

[troubleshooting/selector-mismatch.yaml](troubleshooting/selector-mismatch.yaml) has
`selector.matchLabels: app=correct-app-name` but pod template labels `app=wrong-app-name`. I
expected this to create something broken that I'd then have to diagnose. It never even reaches the
cluster:

```console
$ kubectl apply -f troubleshooting/selector-mismatch.yaml -n session10-lab
The Deployment "selector-error-demo" is invalid: spec.template.metadata.labels: Invalid value: {"app":"wrong-app-name"}: `selector` does not match template `labels`
```

This is worth keeping separate from the Service selector bug in session 11, because they look like
the same mistake and behave completely differently. A Deployment whose selector doesn't match its
own template gets rejected by the API server immediately, since it could never manage pods it can't
select. A Service with a wrong selector is accepted without complaint and just sits there with no
endpoints, because a Service is allowed to point at pods that don't exist yet.

---

## Cleanup

```console
$ kubectl delete namespace session10-lab
namespace "session10-lab" deleted
```

---

## What I Understood

- The objects stack up: a Deployment manages ReplicaSets, and a ReplicaSet manages Pods. You hardly
  ever write a ReplicaSet yourself. Its real job is being the thing a Deployment scales up and down
  to carry out a rollout.
- That pod-template hash in the ReplicaSet name is the mechanism behind the whole rollout system. A
  changed template means a new hash, a new ReplicaSet, and the old one parked at zero so
  `rollout undo` has something to scale back up. `revisionHistoryLimit` decides how many of those
  get kept around.
- Ownership comes from label selectors, not names. Two controllers sharing a selector will fight,
  which is what bit me in Task 1.
- `STATUS` in `kubectl get pods` is a convenience, not the phase. `CrashLoopBackOff` is phase
  `Running` and `ImagePullBackOff` is phase `Pending`. Worth knowing before writing any alerting
  that reads pod state.
- The four strategies are trade-offs rather than a ranking. Rolling update is the sensible default.
  Recreate accepts downtime when versions can't coexist. Blue-green buys an instant cutover and an
  instant rollback by paying for double the capacity. Canary limits the blast radius but can only be
  as granular as your pod count.
- `maxSurge` and `maxUnavailable` are what make a rolling update zero-downtime, and I could see it
  rather than just read it. The ready count never dropped below four in Task 3, and dropped to zero
  in Task 6.
- A failing rollout and an outage aren't the same thing. `maxUnavailable: 0` meant the broken image
  in Task 7 blocked the deploy without ever taking the service down. `UP-TO-DATE` against
  `AVAILABLE` is the pair of columns that tells you which one you're looking at.

---

## Resources

- https://github.com/Nency-Ravaliya/Kubernetes
- k8s core objects: https://github.com/Nency-Ravaliya/Kubernetes/blob/main/core-objects.md
