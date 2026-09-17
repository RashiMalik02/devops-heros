# Session 9 — Kubernetes Fundamentals

**Submitted by:** Rashi
**Enrollment / Roll No:** 10389
**Batch:** B

This session had no manifests in the folder, just the resource links at the bottom, so I worked
through the Kubernetes Basics tutorial and the architecture docs and wrote up what I actually ran. I
used a local `kind` cluster (Kubernetes v1.37.0) rather than minikube, and put the workload parts in
a `session9-lab` namespace.

---

## 1. What a Cluster Is Made Of

```console
$ kubectl cluster-info
Kubernetes control plane is running at https://127.0.0.1:58817
CoreDNS is running at https://127.0.0.1:58817/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy

$ kubectl get nodes -o wide
NAME                          STATUS   ROLES           AGE     VERSION   INTERNAL-IP   OS-IMAGE                       KERNEL-VERSION             CONTAINER-RUNTIME
session12-lab-control-plane   Ready    control-plane   5m21s   v1.37.0   172.22.0.3    Debian GNU/Linux 13 (trixie)   6.12.76-linuxkit (arm64)   containerd://2.3.4
```

One node, which is both the control plane and the worker here. On a real cluster you'd have several
workers and the control plane would be separate. `CONTAINER-RUNTIME` says `containerd`, not Docker,
which surprised me a bit given I started the cluster with Docker installed. Kubernetes dropped
Docker as a runtime in 1.24; Docker is just what's running the node container itself.

The interesting part is that the control plane components are themselves pods:

```console
$ kubectl get pods -n kube-system
NAME                                                  READY   STATUS    RESTARTS   AGE
coredns-559f6c778d-ccpkv                              1/1     Running   0          5m10s
coredns-559f6c778d-d8t82                              1/1     Running   0          5m10s
etcd-session12-lab-control-plane                      1/1     Running   0          5m20s
kindnet-j94zg                                         1/1     Running   0          5m10s
kube-apiserver-session12-lab-control-plane            1/1     Running   0          5m20s
kube-controller-manager-session12-lab-control-plane   1/1     Running   0          5m20s
kube-proxy-gbw5x                                      1/1     Running   0          5m10s
kube-scheduler-session12-lab-control-plane            1/1     Running   0          5m20s
```

Mapping those to what the architecture docs describe:

| Pod | Job |
| :--- | :--- |
| `kube-apiserver` | The front door. Every `kubectl` command and every controller talks to this and nothing else. |
| `etcd` | The database. The entire cluster state lives here and nowhere else. |
| `kube-scheduler` | Decides which node a new pod should run on. Doesn't start it. |
| `kube-controller-manager` | Runs the reconcile loops — the thing that notices reality doesn't match the spec. |
| `kube-proxy` | Programs the node's network rules so Service IPs actually route. |
| `coredns` | Cluster DNS. Two replicas because everything depends on it. |
| `kindnet` | The CNI plugin, giving pods their IPs. This one is kind-specific. |

The kubelet is the one that isn't in this list, because it runs as a normal process on the node
rather than as a pod. It has to — something has to exist before pods can be started.

---

## 2. Running a Pod

```console
$ kubectl run nginx-first-pod --image=nginx:1.25-alpine -n session9-lab
pod/nginx-first-pod created

$ kubectl get pod nginx-first-pod -n session9-lab -o wide
NAME              READY   STATUS    RESTARTS   AGE   IP            NODE
nginx-first-pod   1/1     Running   0          0s    10.244.0.14   session12-lab-control-plane
```

The pod got its own IP, `10.244.0.14`, which is on the pod network, not the node network
(`172.22.0.3`). Every pod gets one and they can all reach each other directly.

The events in `describe` are the clearest thing I found for understanding the architecture, because
they show each component doing its bit in order:

```console
$ kubectl describe pod nginx-first-pod -n session9-lab
Events:
  Type    Reason     Age   From               Message
  ----    ------     ----  ----               -------
  Normal  Scheduled  3s    default-scheduler  Successfully assigned session9-lab/nginx-first-pod to session12-lab-control-plane
  Normal  Pulled     3s    kubelet            Container image "nginx:1.25-alpine" already present on machine
  Normal  Created    3s    kubelet            Container created
  Normal  Started    3s    kubelet            Container started
```

The scheduler assigns, then the kubelet on that node pulls, creates and starts. Two different
components, and the handoff between them is visible. That's the whole flow: `kubectl` sends the
request to the API server, the API server writes it to etcd, the scheduler notices an unassigned pod
and picks a node, the kubelet on that node notices a pod assigned to it and starts the container.
Nothing ever talks directly to anything except the API server.

```console
$ kubectl exec nginx-first-pod -n session9-lab -- nginx -v
nginx version: nginx/1.25.5
```

---

## 3. Deployments and Self-Healing

```console
$ kubectl create deployment web --image=nginx:1.25-alpine --replicas=3 -n session9-lab
deployment.apps/web created

$ kubectl get deployment,rs,pods -n session9-lab -l app=web
NAME                  READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/web   3/3     3            3           0s

NAME                             DESIRED   CURRENT   READY   AGE
replicaset.apps/web-68847bc8d4   3         3         3       0s

NAME                       READY   STATUS    RESTARTS   AGE
pod/web-68847bc8d4-mb4hm   1/1     Running   0          0s
pod/web-68847bc8d4-npxlf   1/1     Running   0          0s
pod/web-68847bc8d4-slvb7   1/1     Running   0          0s
```

One command produced three objects. The Deployment made a ReplicaSet, and the ReplicaSet made the
pods.

Scaling is just changing the desired number:

```console
$ kubectl scale deployment web --replicas=5 -n session9-lab
deployment.apps/web scaled
       5
```

### The bit that actually demonstrates the point

I deleted a pod belonging to the Deployment:

```console
deleting managed pod: web-68847bc8d4-5mhz8
pod "web-68847bc8d4-5mhz8" deleted from session9-lab namespace
still 5 pods - Deployment replaced it
```

Then I deleted the bare pod I made with `kubectl run` in section 2:

```console
$ kubectl delete pod nginx-first-pod -n session9-lab
pod "nginx-first-pod" deleted from session9-lab namespace

$ kubectl get pod nginx-first-pod -n session9-lab
Error from server (NotFound): pods "nginx-first-pod" not found
```

Gone, permanently. Same command, completely different outcome. This is the difference between
something the controller-manager is watching and something nobody is watching. Kubernetes isn't
magically self-healing — a reconcile loop is comparing desired state against actual state, and a
bare pod has no desired state recorded anywhere for it to be compared against.

---

## 4. Exposing It

```console
$ kubectl expose deployment web --port=80 --name=web-svc -n session9-lab
service/web-svc exposed

$ kubectl get svc web-svc -n session9-lab
NAME      TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)   AGE
web-svc   ClusterIP   10.96.113.155   <none>        80/TCP    0s
```

Testing it from a throwaway pod, using the service name rather than any IP:

```console
$ kubectl run tmp --rm -i --image=curlimages/curl:8.5.0 --restart=Never -n session9-lab -- curl -s -o /dev/null -w "%{http_code}\n" web-svc
200
pod "tmp" deleted
```

200, and I never had to know a single pod IP. Pod IPs change constantly as pods get replaced; the
service name doesn't. Session 11 goes into this properly.

---

## 5. Namespaces and Finding Your Way Around

```console
$ kubectl get namespaces
NAME                 STATUS   AGE
default              Active   6m3s
ingress-nginx        Active   5m35s
kube-node-lease      Active   6m3s
kube-public          Active   6m3s
kube-system          Active   6m3s
local-path-storage   Active   5m59s
session9-lab         Active   38s
```

Namespaces are just a way of grouping names, not a security boundary on their own. Two Deployments
called `web` can coexist as long as they're in different namespaces.

Not everything is namespaced, though:

```console
$ kubectl api-resources --namespaced=true | head -8
NAME                        SHORTNAMES   APIVERSION                     NAMESPACED   KIND
bindings                                 v1                             true         Binding
configmaps                  cm           v1                             true         ConfigMap
endpoints                   ep           v1                             true         Endpoints
events                      ev           v1                             true         Event
limitranges                 limits       v1                             true         LimitRange
persistentvolumeclaims      pvc          v1                             true         PersistentVolumeClaim
pods                        po           v1                             true         Pod
```

Nodes, PersistentVolumes and ClusterRoles are cluster-scoped, which is why `kubectl get nodes`
ignores `-n` entirely. This command is also where the short names come from, so `kubectl get po` and
`kubectl get svc` stop being things you just memorise.

The other command I wish I'd found sooner:

```console
$ kubectl explain pod.spec.containers
KIND:       Pod
VERSION:    v1

FIELD: containers <[]Container>

DESCRIPTION:
    List of containers belonging to the pod. Containers cannot currently be
```

It reads the schema out of the API server, so it's documentation for the exact version you're
running instead of whatever the internet says.

---

## Cleanup

```console
$ kubectl delete namespace session9-lab
namespace "session9-lab" deleted
```

---

## What I Understood

- Everything goes through the API server. The scheduler, the kubelet, the controllers and `kubectl`
  all talk to it and never to each other, which is why the whole thing can be extended by adding
  another controller that watches the same API.
- etcd holds the entire cluster state. Every other component is replaceable and restartable because
  none of them store anything important themselves.
- The control plane components run as ordinary pods in `kube-system`, which I found genuinely odd at
  first. The kubelet is the exception, and has to be, because something has to start pods before
  pods can exist.
- Scheduling and starting are two separate jobs done by two separate components. You can watch the
  handoff in `kubectl describe` events.
- Self-healing is a reconcile loop, not a property of pods. A pod under a Deployment comes back
  because something is watching a desired count. A bare pod doesn't come back because nothing is.
- `kubectl run` is fine for a throwaway test, but real workloads want a Deployment, precisely
  because of the above.
- Declarative beats imperative. `kubectl create deployment` and `kubectl scale` are quick, but they
  leave no record of what the cluster is meant to look like. YAML in git does.
- `kubectl explain` and `kubectl api-resources` mean you can answer most "what field goes here"
  questions from the cluster itself.

---

## Resources

- https://kubernetes.io/docs/tutorials/kubernetes-basics/
- https://minikube.sigs.k8s.io/docs/start/?arch=%2Fmacos%2Farm64%2Fstable%2Fbinary+download
- https://kubernetes.io/docs/concepts/architecture/
- https://github.com/Nency-Ravaliya/Kubernetes
