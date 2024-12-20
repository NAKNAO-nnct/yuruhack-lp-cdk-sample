import * as cdk from 'aws-cdk-lib';
import { Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

export class YuruhackCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, 'YuruhackVPC', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{
        name: 'public',
        subnetType: ec2.SubnetType.PUBLIC,
      }],
    });

    // Public Subnet
    const publicSubnet = vpc.publicSubnets[0];

    // s3://yuruhack-assets へのフル権限を持つ policy
    const s3Policy = new iam.PolicyStatement({
      actions: [
        's3:*',
      ],
      resources: ['arn:aws:s3:::yuruhack-assets/*'],
    });

    // IAM Role
    const role = new iam.Role(this, 'yuruhackSampleRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });

    // TODO: S3は最小限の権限を付与する
    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess'));
    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'));
    role.addToPolicy(s3Policy);

    // User Data for EC2 to install Docker
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'yum update -y',

      // Install Docker
      'yum install -y docker git tmux wget',
      'service docker start',
      'chkconfig docker on',
      'usermod -a -G docker ec2-user',

      // Install Docker Compose
      'mkdir -p /usr/local/lib/docker/cli-plugins',
      'curl -L "https://github.com/docker/compose/releases/download/v2.16.0/docker-compose-linux-x86_64" -o /usr/local/lib/docker/cli-plugins/docker-compose',
      'chmod +x /usr/local/lib/docker/cli-plugins/docker-compose',

      //
      'cd /home/ec2-user',
      'git clone https://github.com/NAKNAO-nnct/yuruhack-lt-app-sample.git',
      'cd yuruhack-lt-app-sample',
      'docker compose up -d'
    );

    // Security Group for EC2
    const sg = new ec2.SecurityGroup(this, 'yuruhack-wp-sg', {
      vpc,
      allowAllOutbound: true,
    });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(5000), 'Allow HTTP access');

    // EC2 Instance
    const ec2Instance = new ec2.Instance(this, 'Yuruhack_WP_Instance', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      vpcSubnets: { subnets: [publicSubnet] },
      role,
      securityGroup: sg,
      userData,
      ssmSessionPermissions: true,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(20,{
            deleteOnTermination: true,
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          }),
        }
      ]
    });

    // S3 Bucket
    const bucket = new s3.Bucket(this, 'yuruhack-assets', {
      bucketName: 'yuruhack-assets',
      publicReadAccess: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });


    // ローカルからS3にファイルをアップロードする場合
    // new s3deploy.BucketDeployment(this, 'DeployFiles', {
    //   sources: [s3deploy.Source.asset('./assets')],
    //   destinationBucket: bucket,
    // });
  }
}
