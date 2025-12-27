# Lambda Functions

Three Lambda functions for TTE Server Manager backend.

## Structure

```
lambda/
├── shared/              # Common utilities (bundled with each function)
│   ├── utils/          # AWS SDK, permissions, DynamoDB, responses
│   └── middleware/     # Error handling
├── instance-manager/   # EC2 instance lifecycle
├── server-manager/     # TShock game server operations
├── user-manager/       # User permissions and roles
├── build.js            # Build script
└── dist/               # Output (gitignored)
```

## Development

1. **Install dependencies for each function:**
   ```bash
   cd instance-manager && npm install
   cd ../server-manager && npm install
   cd ../user-manager && npm install
   cd ../shared && npm install
   ```

2. **Test locally:**
   Use AWS SAM or Lambda test events

3. **Build for deployment:**
   ```bash
   node build.js
   ```
   Creates ZIP files in `dist/` ready for Lambda upload

## API Gateway Routing

Map routes to Lambda functions in API Gateway:

- `/instances/*` → `instance-manager`
- `/servers/*` → `server-manager`
- `/permissions/*`, `/users/*` → `user-manager`

## Environment Variables

Each function needs:
- `AWS_REGION`
- `DYNAMO_TABLE_PERMISSIONS`
- `DYNAMO_TABLE_USERS`
- `DYNAMO_TABLE_TOOL_LOGS`
- `ALLOWED_ORIGIN` (CORS)

Additionally:
- **instance-manager**: `EC2_INSTANCE_IDS`
- **server-manager**: `TSHOCK_SECRET_NAME`

## IAM Permissions

Grant each function least-privilege access:
- **instance-manager**: EC2, SSM
- **server-manager**: Secrets Manager
- **user-manager**: DynamoDB (all tables)
- All: CloudWatch Logs

## Deployment

Use your IaC tool (CDK, Terraform, SAM) to:
1. Create Lambda functions from ZIP files in `dist/`
2. Set environment variables
3. Attach IAM roles
4. Configure API Gateway routes
