const authService = require('d:/MezaTech/IDT/engine/authenticity-service');

async function test() {
    console.log('Testing Authenticity Service...');
    const { execFile } = require('child_process');
    const binary = 'd:/MezaTech/IDT/resources/bin/win32/idevice_id.exe';
    
    execFile(binary, ['-l'], async (error, stdout, stderr) => {
        const uuids = stdout.split('\n').map(l => l.trim()).filter(l => l);
        if (uuids.length > 0) {
            const uuid = uuids[0];
            console.log(`Testing scan for ${uuid}...`);
            const start = Date.now();
            await authService.checkAuthenticity(uuid);
            console.log(`Scan completed in ${Date.now() - start}ms`);
        }
    });
}

test();
