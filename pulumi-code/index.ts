import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";
import * as helm from "@pulumi/kubernetes/helm/v3"
import * as nginx from "@pulumi/kubernetes-ingress-nginx";

// Create VPC
const main = new aws.ec2.Vpc("dev-vpc", {
    cidrBlock: "10.0.0.0/16",
    instanceTenancy: "default",
    tags: {
        Name: "dev-vpc",
    },
});

// Create subnets
const publicSubnet = new aws.ec2.Subnet("dev-public-subnet", {
    vpcId: main.id,
    cidrBlock: "10.0.1.0/24",
    availabilityZone: "ap-south-1c",
    mapPublicIpOnLaunch: true,
    tags: {
        Name: "dev-public-subnet",
    },
});

const privateSubnet = new aws.ec2.Subnet("dev-private-subnet", {
    vpcId: main.id,
    cidrBlock: "10.0.2.0/24",
    availabilityZone: "ap-south-1b",
    tags: {
        Name: "dev-private-subnet",
    },
});

//Configure an Internet Gateway
const gw = new aws.ec2.InternetGateway("dev-igw", {
    vpcId: main.id,
    tags: {
        Name: "dev-igw",
    },
});

// Route tables for two subnets
const publicRt = new aws.ec2.RouteTable("dev-public-rt", {
    vpcId: main.id,
    routes: [
        {
            cidrBlock: "0.0.0.0/0",
            gatewayId: gw.id,
        },
        
    ],
    tags: {
        Name: "dev-public-rt",
    },
});

const privateRt = new aws.ec2.RouteTable("dev-private-rt", {
    vpcId: main.id,
    routes: [
        {
            cidrBlock: "0.0.0.0/0",
            gatewayId: gw.id,
        }
    ],
    tags: {
        Name: "dev-private-rt",
    },
}); 

const publicRtAssociation = new aws.ec2.RouteTableAssociation("public-rt-association", {
    subnetId: publicSubnet.id,
    routeTableId: publicRt.id,
}); 

const privateRtAssociation = new aws.ec2.RouteTableAssociation("private-rt-association", {
    subnetId: privateSubnet.id,
    routeTableId: privateRt.id,
});

const eksSG = new aws.ec2.SecurityGroup("eks-sg", {
    vpcId: main.id,
    ingress: [{
        description: "Allow all traffic",
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
    }],
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
        ipv6CidrBlocks: ["::/0"],
    }],
    tags: {
        Name: "eks-sg",
    },
})

// Create IAM Role For EKS Cluster
const assumeRole = aws.iam.getPolicyDocument({
    statements: [{
        effect: "Allow",
        principals: [{
            type: "Service",
            identifiers: ["eks.amazonaws.com"],
        }],
        actions: ["sts:AssumeRole"],
    }],
});
const EKSRole = new aws.iam.Role("EKS-Cluster-Role", {assumeRolePolicy: assumeRole.then(assumeRole => assumeRole.json)});

const EKSClusterPolicy = new aws.iam.RolePolicyAttachment("example-AmazonEKSClusterPolicy", {
    policyArn: "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy",
    role: EKSRole.name,
});

const EKSVPCResourceController = new aws.iam.RolePolicyAttachment("EKSVPCResourceController", {
    policyArn: "arn:aws:iam::aws:policy/AmazonEKSVPCResourceController",
    role: EKSRole.name,
}); 

const EKSRDSAccess = new aws.iam.RolePolicyAttachment("EKS-RDS-Access-Policy", {
    policyArn: "arn:aws:iam::aws:policy/AmazonRDSFullAccess",
    role: EKSRole.name,
});

// Security group for nodes
const nodeSG = new aws.ec2.SecurityGroup("node-sg", {
    vpcId: main.id,
    ingress: [{
        description: "Allow all traffic",
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
    }],
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
        ipv6CidrBlocks: ["::/0"],
    }],
    tags: {
        Name: "node-sg",
    },
})


// Create IAM Role for Nodegroup
const nodeGroupRole = new aws.iam.Role("Nodegroup-Role", {assumeRolePolicy: JSON.stringify({
    Statement: [{
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: {
            Service: "ec2.amazonaws.com",
        },
    }],
    Version: "2012-10-17",
})});

const EKSWorkerNodePolicy = new aws.iam.RolePolicyAttachment("EKS-Worker-Node-Policy", {
    policyArn: "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    role: nodeGroupRole.name,
});
const EKSCNIPolicy = new aws.iam.RolePolicyAttachment("example-AmazonEKSCNIPolicy", {
    policyArn: "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
    role: nodeGroupRole.name,
});
const EC2ContainerRegistryReadOnly = new aws.iam.RolePolicyAttachment("example-AmazonEC2ContainerRegistryReadOnly", {
    policyArn: "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
    role: nodeGroupRole.name,
});
const EKSRDSPolicy = new aws.iam.RolePolicyAttachment("EKS-RDS-Node-Access-Policy", {
    policyArn: "arn:aws:iam::aws:policy/AmazonRDSFullAccess",
    role: nodeGroupRole.name,
});


// Create EKS Cluster 
const cluster = new eks.Cluster("demo", {
    vpcId: main.id,
    subnetIds: [publicSubnet.id, privateSubnet.id],
    deployDashboard: false,
    clusterSecurityGroup: eksSG,
    serviceRole: EKSRole,
    instanceRole: nodeGroupRole,
    nodeGroupOptions: {
        nodeSubnetIds: [publicSubnet.id, privateSubnet.id],
        desiredCapacity: 2,
        minSize: 2,
        maxSize: 3,
        instanceType: "t2.medium",
        amiType: "AL2_x86_64",
        nodeAssociatePublicIpAddress: true,
        nodeSecurityGroup: nodeSG,
    }
    }); 

// Create Provider
const k8sProvider = new k8s.Provider("k8s-provider", { 
    kubeconfig: cluster.kubeconfig
}) 

const appNamespace = new k8s.core.v1.Namespace("my-app-namespace", {}, { provider: k8sProvider });

// Workloads
const frontendDeployment = new k8s.apps.v1.Deployment("frontend-deployment", {
    
    metadata: {
        name: "frontend-deployment",
        labels: {
            app: "frontend-app"
        },
        namespace: appNamespace.metadata.name
    },
    spec: {
        selector: {
            matchLabels: {
                app: "frontend-app",
            },
        },
        replicas: 1,
        template: {
            metadata: {
                labels: {
                    app: "frontend-app",
                },
            },
            spec: {
                containers: [{
                    name: "frontend-container",
                    image: "623865992637.dkr.ecr.ap-south-1.amazonaws.com/demo:latest",
                    env: [{
                            name: "BACKEND_API_URL",
                            value: "http://nodeapp:3456"
                        }],

                    }]
                }
            }
        }
    },
    { provider: k8sProvider}
)

const frontendService = new k8s.core.v1.Service("frontend-service", {
    metadata:{
        name: "frontend",
        namespace: appNamespace.metadata.name
    },
    spec: {
    type: "NodePort",
    ports: [{
        name: "http",
        port: 3000,
        protocol: "TCP",
        targetPort: 3000,
        }],
    selector: {
        app: "frontend-app",
        },
}},
{ provider: k8sProvider});

// Ingress Controller
const ctrl = new nginx.IngressController("myctrl", {
    controller: {
        publishService: {
            enabled: true,
        },
    },
    helmOptions: {
        namespace: appNamespace.metadata.name,
    },
}, { provider: k8sProvider }); 

// NGINX Ingress
const ingress = new k8s.networking.v1.Ingress("my-app-ingress", {
    metadata: {
        namespace: appNamespace.metadata.name,
        // annotations: {
        //     "kubernetes.io/ingress.class": "nginx",
        // },
    },
    spec: {
        ingressClassName: "nginx",
        rules: [
            {
                // host: "app.deft-source.com",
                http: {
                    paths: [
                        {
                            path: "/",
                            pathType: "Prefix",
                            backend: {
                                service: {
                                    name: frontendService.metadata.name,
                                    port: {
                                        number: frontendService.spec.ports[0].port
                                    }
                                },
                            },
                        },
                    ],
                },
            },
        ],
    },
}, { provider:k8sProvider });

