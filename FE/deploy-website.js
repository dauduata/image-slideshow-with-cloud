#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SCRIPT_DIR = __dirname;
const TARGET_DIR = path.join(SCRIPT_DIR, 'public');
// const DATA_FILE = path.join(SCRIPT_DIR, 'public', 'data.js');
const SERVICE_ACCOUNT = path.join(SCRIPT_DIR, 'firebase-danglephd.iptp.test.json');
const TEN_PROJECT = process.argv[2];

console.log('\n============================================================');
console.log('Firebase Website Project Deployment (Node.js)');
console.log('============================================================');

// Validate parameter
if (!TEN_PROJECT) {
    console.error('\nERROR: Missing project name parameter.');
    console.error('Usage: node deploy-website.js <ten_project>');
    console.error('Example: node deploy-website.js Amenosa\n');
    process.exit(1);
}

console.log(`Project      : ${TEN_PROJECT}`);
// console.log(`data.js      : ${DATA_FILE}`);
console.log(`Service acct : ${SERVICE_ACCOUNT}`);
console.log('============================================================\n');

// Step 1: Check service account
console.log('[1/7] Checking Firebase Service Account...');
if (!fs.existsSync(SERVICE_ACCOUNT)) {
    console.error(`ERROR: Service Account not found: ${SERVICE_ACCOUNT}`);
    process.exit(1);
}
console.log('✓ Service account found\n');

// Step 3: Node version
console.log('[3/7] Verifying Node.js version...');
const nodeVersion = execSync('node --version', { encoding: 'utf-8' }).trim();
console.log(`Node version: ${nodeVersion}\n`);

// Step 4: Firebase CLI version
console.log('[4/7] Checking Firebase CLI...');
try {
    const firebaseVersion = execSync('firebase --version', { encoding: 'utf-8' }).trim();
    console.log(`Firebase version: ${firebaseVersion}\n`);
} catch (e) {
    console.error('ERROR: Firebase CLI not found');
    process.exit(1);
}

// Step 5: Clear cached Firebase user login
console.log('[5/7] Clearing cached Firebase user login...');
try {
    execSync('firebase logout 2>nul', {
        cwd: SCRIPT_DIR,
        stdio: 'ignore'
    });
    console.log('✓ Cached user cleared\n');
} catch (e) {
    // Ignore errors if not logged in
    console.log('✓ No cached user\n');
}

// Step 7: Deploy Firebase
console.log('[7/7] Deploying to Firebase...\n');
console.log('Authentication: Service Account (via GOOGLE_APPLICATION_CREDENTIALS)');
console.log(`Credentials   : ${SERVICE_ACCOUNT}\n`);

try {
    // Set environment variable
    const firebaseEnv = {
        ...process.env,
        GOOGLE_APPLICATION_CREDENTIALS: SERVICE_ACCOUNT
    };
    
    // Run firebase deploy
    console.log('\n[DEPLOY] Running firebase deploy...');
    execSync('firebase deploy', {
        cwd: TARGET_DIR,
        env: firebaseEnv,
        stdio: 'inherit'
    });
    
    console.log('\n============================================================');
    console.log('DEPLOY SUCCESS');
    console.log('============================================================');
    console.log(`Project deployed: ${TEN_PROJECT}`);
    console.log(`URL: https://${TEN_PROJECT.toLowerCase()}.web.app/`);
    console.log(`Firebase Console: https://console.firebase.google.com/project/${TEN_PROJECT}/overview`);
    console.log('============================================================\n');
    
    process.exit(0);
} catch (e) {
    console.error('\n============================================================');
    console.error('DEPLOY FAILED');
    console.error('============================================================');
    console.error(e.message);
    console.error('\nCheck:');
    console.error('1. Service account has required IAM permissions');
    console.error(`2. Service account: firebase-adminsdk-fbsvc@${TEN_PROJECT}.iam.gserviceaccount.com`);
    console.error('3. Required roles: Firebase Hosting Admin, Service Usage Consumer');
    console.error('4. Check firebase-debug.log for details');
    console.error('============================================================\n');
    process.exit(1);
}
