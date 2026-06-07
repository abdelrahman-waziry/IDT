const { execFile } = require('child_process');
const path = require('path');
const plist = require('plist');

const binary = 'd:/MezaTech/IDT/resources/bin/win32/ideviceinfo.exe';

execFile(binary, ['-u', '00008110-001938AA0120A01E', '-x'], { maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
    if (error) {
        console.error(error);
        return;
    }
    const data = plist.parse(stdout);
    const keys = Object.keys(data).filter(k => k.toLowerCase().includes('serial'));
    console.log('Serial keys:', keys);
});
