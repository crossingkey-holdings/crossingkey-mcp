# Security and publication

Report vulnerabilities privately to founder@crossingkeyintelligence.com.
Never include credentials in public issues, examples, logs, or evidence.
Rotate exposed credentials; removing a file does not revoke a secret.

This publisher excludes recognized secret/runtime paths, scans destination
history and the candidate with Gitleaks, and does not import local git history.
Automated scanning is not a guarantee that all sensitive information was found.
Source and dependency security review remain necessary.

This script does not deploy, enable mainnet, change receivers, grant spending
authority, invoke payment tests, or execute application startup/package scripts.
External webhook-based deployment integrations require separate consideration.
