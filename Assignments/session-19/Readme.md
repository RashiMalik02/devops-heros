# Session 19: Cloud Fundamentals and Terraform on AWS

**Submitted by:** Rashi
**Roll No:** 10389
**Batch:** B

Lab files: [session19-cloud-terraform](../../session19-cloud-terraform/). AWS region: `ap-south-1`.

*(Terminal screenshots for the AWS steps are being added.)*

## 1. Cloud Service Models

| Model | You manage | Provider manages | Example |
|---|---|---|---|
| IaaS | OS, runtime, app, data | Hardware, network, virtualisation | EC2, VPC |
| PaaS | App and data | Everything below the app | Elastic Beanstalk, RDS |
| SaaS | Just using it | Everything | Gmail, GitHub |

## 2. Regions and Availability Zones

A **region** is a geographic area (`ap-south-1` = Mumbai) made of several isolated **Availability
Zones** (`ap-south-1a`, `1b`, `1c`), each with separate power and networking. Spreading resources
across AZs keeps an application running if one AZ fails.

## 3. VPC and Subnets

A **VPC** is my own private network in a region, defined by a CIDR block such as `10.0.0.0/16`
(65,536 addresses). It is split into **subnets**, each in one AZ, e.g. `10.0.1.0/24` (256
addresses, 251 usable because AWS reserves 5).

## 4. Route Tables and Internet Gateway

A **route table** decides where traffic leaves a subnet. A subnet is **public** when its route
table has `0.0.0.0/0 → Internet Gateway`; without that route it is **private** and can only reach
the internet through a NAT Gateway.

```text
Internet <-> Internet Gateway <-> Route table (0.0.0.0/0 -> igw) <-> Public subnet <-> EC2
```

## 5. Security Groups

A security group is a **stateful** firewall attached to an instance: inbound rules list what is
allowed in (e.g. SSH 22 from my IP, HTTP 80 from anywhere); return traffic is allowed
automatically. Everything not allowed is denied. Network ACLs are the **stateless**, subnet-level
equivalent.

## 6. Terraform VPC Lab

[06-terraform-vpc](../../session19-cloud-terraform/06-terraform-vpc/) creates a VPC, a public
subnet, an Internet Gateway and a route table with its association.

```text
terraform init -> fmt -> validate -> plan -> apply -> state list / output -> aws ec2 describe-* -> destroy
```

- **Dependencies:** Terraform builds the graph from references; the subnet and IGW reference
  `aws_vpc.main.id`, so the VPC is created first and destroyed last.
- **Exercise, changing the CIDR:** editing `vpc_cidr` shows `-/+` (must be replaced) in the
  plan, because a VPC's CIDR can't be changed in place.

## 7. Terraform Workflow

| Step | Purpose |
|---|---|
| `terraform init` | Download the AWS provider |
| `terraform fmt` / `validate` | Style and correctness checks |
| `terraform plan` | Preview: what will be created, changed, destroyed |
| `terraform apply` | Create the resources, write the state |
| `terraform state list` / `show` | Inspect what Terraform manages |
| `terraform output` | Read IDs and IPs |
| `terraform destroy` | Remove everything |

## 8. Mini Project: VPC 10.20.0.0/16 with EC2 and S3

[08-mini-project](../../session19-cloud-terraform/08-mini-project/) puts together the suggested
architecture:

```text
Terraform
    |
    ├── VPC            10.20.0.0/16
    |     └── Subnet   10.20.1.0/24 (public, ap-south-1a)
    |           └── Route table: 0.0.0.0/0 -> Internet Gateway
    ├── Security Group  SSH 22 / HTTP 80 inbound
    ├── EC2             t3.micro in the public subnet
    └── S3              bucket for the project
```

It demonstrates **providers** (aws), **variables** (`terraform.tfvars`), **resources**,
**outputs** (VPC ID, subnet ID, instance public IP, bucket name), **dependencies**
(VPC → subnet → instance), **state**, `plan`, `apply` and `destroy`. Everything is destroyed at the
end so nothing keeps costing money.

## Key Learnings

- A VPC is my private network; public vs private subnets are decided by route tables.
- Security groups are stateful instance firewalls; NACLs are stateless subnet filters.
- Terraform works out the order of creation from references between resources.
- `plan` shows replacements (`-/+`) before they happen, which is why it's run before every apply.
