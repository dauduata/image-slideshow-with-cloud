const { spawn } = require('node:child_process');
const path = require('node:path');

function runScript(script, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, '..', '..', script), ...args], {
            cwd: path.join(__dirname, '..', '..'),
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let output = '';
        let errorOutput = '';
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { errorOutput += chunk; });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) return resolve(output.trim());
            reject(new Error((errorOutput || output || `Extraction exited with code ${code}`).trim()));
        });
    });
}

module.exports = { runScript };
