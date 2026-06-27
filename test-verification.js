const { runVerification } = require('./engine/verification-orchestrator');
const PythonBridge = require('./engine/python-bridge');

async function test() {
    try {
        console.log('Initializing Python bridge...');
        await PythonBridge.initialize();
        console.log('Bridge ready. Running verification for 00008030-00012DC921DB402E...');
        
        const result = await runVerification('00008030-00012DC921DB402E');
        console.log('\n--- VERIFICATION RESULT ---');
        console.log(JSON.stringify(result, null, 2));
    } catch (err) {
        console.error('Test failed:', err);
    } finally {
        PythonBridge.shutdown();
        process.exit(0);
    }
}

test();
