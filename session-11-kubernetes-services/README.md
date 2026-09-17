# Session 11 — Kubernetes Networking and Services

**Submitted by:** Rashi
**Enrollment / Roll No:** 10389
**Batch:** B

I ran all of this on macOS against a local `kind` cluster (Kubernetes v1.37.0, kind v0.33.0). I put
everything in its own `session11-lab` namespace so I could wipe it in one go at the end without
worrying about what else was on the cluster.

```console
$ kubectl version
Client Version: v1.37.0
Kustomize Version: v5.8.1
Server Version: v1.37.0

$ kubectl create namespace session11-lab
namespace/session11-lab created
```

---

## Summary of the Five Service Types

All five types running side by side at the end of the exercise:

```console
$ kubectl get svc -n session11-lab
NAME                        TYPE           CLUSTER-IP     EXTERNAL-IP        PORT(S)        AGE
broken-backend-service      ClusterIP      10.96.21.158   <none>             80/TCP         9s
external-database-service   ExternalName   <none>         nencyravaliya.me   <none>         2m5s
web-service-clusterip       ClusterIP      10.96.27.207   <none>             8080/TCP       3m1s
web-service-headless        ClusterIP      None           <none>             80/TCP         114s
web-service-loadbalancer    LoadBalancer   10.96.198.34   <pending>          80:31392/TCP   2m35s
web-service-nodeport        NodePort       10.96.252.50   <none>             80:30080/TCP   2m44s
```

Reading down the `CLUSTER-IP` and `EXTERNAL-IP` columns tells you most of what separates the types.

| Folder | Service Type | What it gives you |
| :--- | :--- | :--- |
| [01-clusterip/](01-clusterip/) | ClusterIP | One virtual IP, reachable only inside the cluster |
| [02-nodeport/](02-nodeport/) | NodePort | A fixed port on every node, reachable from outside |
| [03-loadbalancer/](03-loadbalancer/) | LoadBalancer | A cloud-provisioned external IP |
| [04-externalname/](04-externalname/) | ExternalName | A CNAME alias to a host outside the cluster |
| [05-headless/](05-headless/) | Headless (`clusterIP: None`) | Per-pod DNS records instead of one VIP |
| [dns-test/](dns-test/) | — | Pod I used to poke at CoreDNS and FQDNs |
| [troubleshooting/](troubleshooting/) | — | Service with a selector typo, so no endpoints |

Concept notes: [service.md](service.md) and [fqdn.md](fqdn.md).

---

## Task 1: ClusterIP — Internal Only

```console
$ kubectl apply -n session11-lab -f 01-clusterip/
deployment.apps/web-app-clusterip created
pod/curl-client created
service/web-service-clusterip created

$ kubectl get svc web-service-clusterip -n session11-lab
NAME                    TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)    AGE
web-service-clusterip   ClusterIP   10.96.27.207   <none>        8080/TCP   13s
```

There's a `CLUSTER-IP` but no `EXTERNAL-IP`, which is the whole point of this type. The three pods
behind it show up as endpoints:

```console
$ kubectl get endpointslice -n session11-lab -l kubernetes.io/service-name=web-service-clusterip
NAME                          ADDRESSTYPE   PORTS   ENDPOINTS                             AGE
web-service-clusterip-8ltw8   IPv4          80      10.244.0.71,10.244.0.72,10.244.0.70   13s
```

And from a pod inside the cluster it works:

```console
$ kubectl exec -n session11-lab curl-client -- curl -s web-service-clusterip:8080
<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
```

Small thing that tripped me up: the service listens on `8080` but nginx listens on `80`. That's
`port: 8080` and `targetPort: 80` in the manifest, and I had them mixed up in my head at first. The
port you curl is the service's, not the container's.

---

## Task 2: NodePort — External Access via the Node

```console
$ kubectl apply -n session11-lab -f 02-nodeport/
deployment.apps/web-app-nodeport created
service/web-service-nodeport created

$ kubectl get svc web-service-nodeport -n session11-lab
NAME                   TYPE       CLUSTER-IP     EXTERNAL-IP   PORT(S)        AGE
web-service-nodeport   NodePort   10.96.252.50   <none>        80:30080/TCP   5s
```

The `80:30080/TCP` is the giveaway. It still has a ClusterIP, and on top of that it's opened port
`30080` on the node.

The course notes say to use `curl http://$(minikube ip):30080`, but I'm on kind, not minikube, so
there's no `minikube ip` to call. The kind node is just a Docker container, so I hit the port from
inside it instead:

```console
$ kubectl get node kepler-docs-control-plane -o jsonpath='{.status.addresses[?(@.type=="InternalIP")].address}'
172.22.0.2

$ docker exec kepler-docs-control-plane curl -s -o /dev/null -w "%{http_code}\n" localhost:30080
200
```

200, so the NodePort is serving. On minikube the same check would just be `curl $(minikube ip):30080`.

---

## Task 3: LoadBalancer

```console
$ kubectl apply -n session11-lab -f 03-loadbalancer/
deployment.apps/web-app-loadbalancer created
service/web-service-loadbalancer created

$ kubectl get svc web-service-loadbalancer -n session11-lab
NAME                       TYPE           CLUSTER-IP     EXTERNAL-IP   PORT(S)        AGE
web-service-loadbalancer   LoadBalancer   10.96.198.34   <pending>     80:31392/TCP   0s
```

`EXTERNAL-IP` came back `<pending>`. I waited to see if it would resolve, and it didn't:

```console
t+1: EXTERNAL-IP=<pending>
t+2: EXTERNAL-IP=<pending>
t+3: EXTERNAL-IP=<pending>
t+4: EXTERNAL-IP=<pending>
t+5: EXTERNAL-IP=<pending>
```

I assumed I'd broken something, but this is just what happens locally. A `LoadBalancer` service is
really a request to the cloud provider's controller to go and provision an actual load balancer. A
plain kind cluster has no cloud controller running, so nothing ever picks the request up and the
field stays empty forever. On EKS or GKE this would come back as a public IP. To get it working
locally you'd need `cloud-provider-kind` or MetalLB, or `minikube tunnel` if you're on minikube.

The useful part is what still works. A LoadBalancer is a NodePort with extra stuff on top, so
Kubernetes had already allocated node port `31392` underneath, and that responds fine:

```console
$ docker exec kepler-docs-control-plane curl -s -o /dev/null -w "%{http_code}\n" localhost:31392
200
```

---

## Task 4: ExternalName — A DNS Alias

```console
$ kubectl apply -n session11-lab -f 04-externalname/
pod/dns-test-client created
service/external-database-service created

$ kubectl get svc external-database-service -n session11-lab
NAME                        TYPE           CLUSTER-IP   EXTERNAL-IP        PORT(S)   AGE
external-database-service   ExternalName   <none>       nencyravaliya.me   <none>    3s
```

No `CLUSTER-IP` and no ports at all. This one is purely a DNS record, which makes it the odd one out
of the five. CoreDNS hands back a CNAME pointing at the external host:

```console
$ kubectl exec -n session11-lab dns-test-client -- nslookup external-database-service
Server:		10.96.0.10
Address:	10.96.0.10:53

** server can't find external-database-service.cluster.local: NXDOMAIN
** server can't find external-database-service.svc.cluster.local: NXDOMAIN

external-database-service.session11-lab.svc.cluster.local	canonical name = nencyravaliya.me
```

Those `NXDOMAIN` lines made me think the lookup had failed. They haven't. The resolver is walking
the `search` list in `/etc/resolv.conf` in order, and the attempt with the namespace in it is the
one that matches. Everything before it is just the resolver trying and missing.

Nothing is proxied here and there's no load balancing. The pod gets a name and connects straight out
to the external host. The point is that the app can keep saying `external-database-service` in its
config, and you can repoint it somewhere else by editing one field instead of redeploying.

---

## Task 5: Headless Service

```console
$ kubectl apply -n session11-lab -f 05-headless/
statefulset.apps/web-stateful created
pod/headless-dns-client created
service/web-service-headless created

$ kubectl get svc web-service-headless -n session11-lab
NAME                   TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE
web-service-headless   ClusterIP   None         <none>        80/TCP    4s
```

`CLUSTER-IP` is literally the word `None`, which is what `clusterIP: None` in the manifest asks for.

```console
$ kubectl get pods -l app=web-headless -n session11-lab -o wide
web-stateful-0 1/1 Running 10.244.0.80
web-stateful-1 1/1 Running 10.244.0.81
web-stateful-2 1/1 Running 10.244.0.82
```

Since there's no VIP to hand out, DNS returns one A record per pod:

```console
$ kubectl exec -n session11-lab headless-dns-client -- nslookup web-service-headless.session11-lab.svc.cluster.local
Name:	web-service-headless.session11-lab.svc.cluster.local
Address: 10.244.0.80
Name:	web-service-headless.session11-lab.svc.cluster.local
Address: 10.244.0.81
Name:	web-service-headless.session11-lab.svc.cluster.local
Address: 10.244.0.82
```

Three addresses, matching the three pod IPs above. Going back and running the same lookup against
the ClusterIP service from Task 1 makes the difference obvious:

```console
$ kubectl exec -n session11-lab curl-client -- nslookup web-service-clusterip.session11-lab.svc.cluster.local
Name:	web-service-clusterip.session11-lab.svc.cluster.local
Address: 10.96.27.207
```

One address, and it isn't even a pod IP. It's the virtual IP.

Because this is a headless service in front of a StatefulSet, each pod also gets its own permanent
name. This is the bit that makes it useful for databases, where a replica needs to talk to one
specific peer rather than "whichever one you feel like":

```console
$ kubectl exec -n session11-lab headless-dns-client -- nslookup web-stateful-0.web-service-headless.session11-lab.svc.cluster.local
Name:	web-stateful-0.web-service-headless.session11-lab.svc.cluster.local
Address: 10.244.0.80
```

---

## Task 6: FQDN and CoreDNS Resolution

```console
$ kubectl apply -n session11-lab -f dns-test/curl-test-pod.yaml
pod/curl-test-pod created

$ kubectl exec -n session11-lab curl-test-pod -- cat /etc/resolv.conf
search session11-lab.svc.cluster.local svc.cluster.local cluster.local
nameserver 10.96.0.10
options ndots:5
```

That `nameserver 10.96.0.10` is the CoreDNS service, which is itself just two pods:

```console
$ kubectl get pods -n kube-system -l k8s-app=kube-dns
coredns-559f6c778d-7jc6c 1/1 Running
coredns-559f6c778d-qlksg 1/1 Running
```

Within the same namespace, the short name and the full FQDN both work, because the first entry in
that `search` list completes the short name for you:

```console
$ kubectl exec -n session11-lab curl-test-pod -- curl -s -o /dev/null -w "%{http_code}\n" web-service-clusterip:8080
200

$ kubectl exec -n session11-lab curl-test-pod -- curl -s -o /dev/null -w "%{http_code}\n" web-service-clusterip.session11-lab.svc.cluster.local:8080
200
```

Across namespaces it's a different story, and I think this is the part that actually matters day to
day. The `kubernetes` service lives in the `default` namespace. From a pod in `session11-lab`:

```console
$ kubectl exec -n session11-lab curl-test-pod -- nslookup kubernetes
** server can't find kubernetes.cluster.local: NXDOMAIN
command terminated with exit code 1

$ kubectl exec -n session11-lab curl-test-pod -- nslookup kubernetes.default.svc.cluster.local
Name:	kubernetes.default.svc.cluster.local
Address: 10.96.0.1
```

Same service, same cluster, one resolves and one doesn't. A short name only ever works inside the
pod's own namespace. To reach anything outside it you need at least `<service>.<namespace>`, and the
full form is `<service>.<namespace>.svc.cluster.local`.

---

## Task 7: Troubleshooting — A Service With No Endpoints

[troubleshooting/empty-endpoints.yaml](troubleshooting/empty-endpoints.yaml) selects
`app: wrong-backend-name`, but the backend pods are actually labelled `app: yatri-backend`.

```console
$ kubectl apply -n session11-lab -f deployment/backend-deployment.yaml -f troubleshooting/empty-endpoints.yaml
deployment.apps/yatri-backend created
service/broken-backend-service created

$ kubectl get endpoints broken-backend-service -n session11-lab
Warning: v1 Endpoints is deprecated in v1.33+; use discovery.k8s.io/v1 EndpointSlice
NAME                     ENDPOINTS   AGE
broken-backend-service   <none>      0s
```

The service gets created without complaint. Nothing checks that a selector actually matches
anything. It just sits there with no endpoints, and every request to it gets refused. This is the
annoying kind of bug because `kubectl get svc` shows a service that looks completely fine.

`describe` is where the problem shows up:

```console
$ kubectl describe svc broken-backend-service -n session11-lab
Selector:                 app=wrong-backend-name
Endpoints:
```

Then compare that selector against the labels the pods are actually carrying:

```console
$ kubectl get pods -l app=yatri-backend -n session11-lab --show-labels
yatri-backend-dc5888c55-6hj4t Running app=yatri-backend,pod-template-hash=dc5888c55,tier=api
yatri-backend-dc5888c55-lgvdk Running app=yatri-backend,pod-template-hash=dc5888c55,tier=api
yatri-backend-dc5888c55-nk6jx Running app=yatri-backend,pod-template-hash=dc5888c55,tier=api
```

`wrong-backend-name` versus `yatri-backend`. Fixing the selector fills the endpoints in straight
away, no restart needed:

```console
$ kubectl patch svc broken-backend-service -n session11-lab -p '{"spec":{"selector":{"app":"yatri-backend"}}}'
service/broken-backend-service patched

$ kubectl get endpointslice -n session11-lab -l kubernetes.io/service-name=broken-backend-service
NAME                           ADDRESSTYPE   PORTS   ENDPOINTS                             AGE
broken-backend-service-9s8z9   IPv4          5000    10.244.0.84,10.244.0.86,10.244.0.85   4s
```

One more thing worth noting from the warning above: `Endpoints` is deprecated from Kubernetes 1.33
onwards, so the current way to run this check is
`kubectl get endpointslice -l kubernetes.io/service-name=<svc>`.

---

## Cleanup

Everything went into one namespace, so this is the whole cleanup:

```console
$ kubectl delete namespace session11-lab
namespace "session11-lab" deleted
```

---

## What I Understood

- A Service isn't a process running somewhere. It's a set of rules programmed into every node plus a
  DNS record. I'd been picturing some kind of proxy pod sitting in the middle, and there isn't one.
- The types build on each other instead of being four separate things. NodePort is a ClusterIP plus
  a port on every node, and LoadBalancer is a NodePort plus an external IP. Seeing the LoadBalancer
  service still hand me a working node port while its `EXTERNAL-IP` sat at `<pending>` is what made
  that click.
- `port` and `targetPort` are easy to confuse. `port` is what you curl, `targetPort` is what the
  container is actually listening on, and they don't have to match.
- ExternalName doesn't really behave like the others at all. No IP, no ports, no proxying, just a
  CNAME. It exists so your app config can stay the same while the thing behind it moves.
- Headless services trade the single VIP for per-pod DNS. You lose the free load balancing and gain
  the ability to address one specific pod, which is exactly what StatefulSet workloads need.
- `ndots:5` is the reason short names work at all, and also the reason `nslookup` output is full of
  NXDOMAIN lines that look like failures but aren't.
- A selector typo produces a service that passes every casual check. Empty endpoints are the thing
  to look for, and `describe svc` next to `get pods --show-labels` is the fastest way to catch it.

---

## Resources

- https://kubernetes.io/docs/concepts/services-networking/service/
- https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/
