# Session 18: Terraform and Infrastructure as Code

**Submitted by:** Rashi
**Roll No:** 10389
**Batch:** B

Lab files: [session18-terraform-iac](../../session18-terraform-iac/). AWS region: `ap-south-1`.

*(Terminal screenshots for each step are being added.)*

## 1. Infrastructure as Code

Infrastructure as Code means describing servers, networks and storage in **files** instead of
clicking in a console. The files are versioned in Git, reviewed like code, and the same file
creates the same infrastructure every time.

| Manual (console) | Infrastructure as Code |
|---|---|
| Click-ops, hard to repeat | Same code → same result, every environment |
| No history of who changed what | Every change is a Git commit |
| Drift goes unnoticed | `terraform plan` shows the difference between code and reality |

Terraform is **declarative**: you describe the end state, Terraform works out the create /
update / delete steps.

## 2. Terraform Architecture

```text
.tf files  ->  Terraform Core  ->  Provider plugin (aws)  ->  AWS API
                     |
                terraform.tfstate  (what Terraform believes exists)
```

- **Core** reads the configuration, compares it with the state and builds a plan.
- **Providers** are plugins that talk to a platform's API (AWS, Azure, Kubernetes...).
- **State** maps resources in code to real resource IDs.

## 3. Providers

```hcl
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}
provider "aws" {
  region = "ap-south-1"
}
```

`terraform init` downloads the provider into `.terraform/` and records exact versions in
`.terraform.lock.hcl`.

## 4. Resources

```hcl
#        resource type   local name
resource "aws_s3_bucket" "demo" {
  bucket = "rashimalik-tf-demo-20260929"
  tags   = { Owner = "Rashi" }
}
```

Adding a tag is an **update in place** (`~` in the plan); changing the bucket name forces
**replace** (`-/+`).

## 5. Variables

Variables make one configuration reusable across environments:

```hcl
variable "environment" { type = string  default = "dev" }
```

Values come from defaults, `terraform.tfvars`, `-var-file=`, `-var` or `TF_VAR_` environment
variables. Planning with `dev` and `test` gives different names and tags from the same code.

## 6. Outputs

Outputs print useful values after apply (bucket name, ARN, region) and let other tools or
modules read them: `terraform output`, `terraform output -raw bucket_name`.

## 7. Init, Plan and Apply

| Command | What it does |
|---|---|
| `terraform init` | Download providers, set up the backend |
| `terraform fmt` | Format the files in the standard style |
| `terraform validate` | Check syntax and references |
| `terraform plan` | Show what would change (`+` create, `~` update, `-` destroy) |
| `terraform apply` | Make the changes after confirmation |
| `terraform plan -out=tfplan` / `apply tfplan` | Apply exactly the plan that was reviewed |

## 8. Destroy

`terraform destroy` (or `plan -destroy` first) removes everything in the state. Used at the end of
every lab so nothing keeps running or costing money.

## 9. State

`terraform.tfstate` is Terraform's record of real resources. `terraform state list` and
`terraform state show <address>` inspect it. It can contain secrets, so it is in `.gitignore` and
in teams lives in a remote backend (S3 + locking) instead of a laptop.

## 10. Demo Project: S3 Bucket

[terraform-s3-demo](../../session18-terraform-iac/terraform-s3-demo/) creates one S3 bucket,
`rashimalik-tf-demo-20260929`, in `ap-south-1`.

```text
terraform-s3-demo/
├── providers.tf / terraform.tf   provider + version constraints
├── variables.tf                  bucket name, region, tags
├── terraform.tfvars              my values
├── main.tf                       aws_s3_bucket resource
└── outputs.tf                    bucket_name, bucket_arn, bucket_region
```

Workflow: `init` → `fmt` → `validate` → `plan` → `apply` → `show` / `output` / `state list` →
verify with `aws s3 ls` and `aws s3api head-bucket` → `destroy`.

```text
Apply complete! Resources: 1 added, 0 changed, 0 destroyed.
Outputs:
bucket_arn    = "arn:aws:s3:::rashimalik-tf-demo-20260929"
bucket_name   = "rashimalik-tf-demo-20260929"
bucket_region = "ap-south-1"
```

## 11. AWS Services Research

### IAM (Governance)
IAM controls **who** can do **what** in an AWS account. **Users** are people or apps with
long-term credentials, **groups** bundle users, **roles** are assumed temporarily (by EC2, Lambda,
CI pipelines, other accounts), and **policies** are JSON documents that allow or deny actions on
resources. Best practice is **least privilege**: grant only what's needed, use roles instead of
access keys, turn on MFA, never use the root account day to day, and rotate credentials.

### EC2 (Compute)
EC2 gives virtual servers. An **AMI** is the image it boots from, the **instance type**
(t3.micro, m7g.large...) sets CPU/RAM, a **key pair** allows SSH, **security groups** are
stateful firewalls, and **EBS** volumes are its disks. Instances get a private IP inside the VPC
and optionally a public IP. Lifecycle: pending → running → stopping/stopped → terminated.

### S3 (Storage)
S3 is object storage: **buckets** (globally unique names) hold **objects** (files + metadata) by
key. **Storage classes** (Standard, Standard-IA, Glacier) trade cost against access speed,
**versioning** keeps old copies, **lifecycle policies** move or delete objects over time, data is
**encrypted** at rest (SSE-S3/SSE-KMS), and **bucket policies** + Block Public Access control who
can read it. Used for backups, static websites, logs, data lakes and Terraform state.

### VPC (Networking)
A VPC is a private network in AWS defined by a **CIDR** block (e.g. 10.0.0.0/16), split into
**subnets** per Availability Zone. **Route tables** decide where traffic goes; a **public
subnet** has a route to an **Internet Gateway**, a **private subnet** reaches out through a **NAT
Gateway**. **Security groups** (stateful, per instance) and **network ACLs** (stateless, per
subnet) filter traffic.

### DynamoDB and RDS (Databases)
**DynamoDB** is a managed NoSQL key-value/document database: **tables** of **items** made of
**attributes**, addressed by a **partition key** (and optional **sort key**), scaling
automatically. Good for sessions, carts, IoT and high-traffic lookups.
**RDS** runs managed relational databases (MySQL, PostgreSQL, MariaDB, Oracle, SQL Server, Aurora)
on **DB instances**, with automated **backups**, **Multi-AZ** standby for failover, **read
replicas** for read scaling, and security through VPC subnets, security groups and encryption.
Good for transactional apps with joins and strict consistency.

## Key Learnings

- Infrastructure described in code is repeatable, reviewable and versioned.
- `plan` before `apply`, always; `destroy` at the end of every lab.
- State is the link between code and reality, so protect it and keep it out of Git.
