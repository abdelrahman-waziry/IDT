import Foundation

print("Starting Fixtech Companion App...")

// Start the local HTTP server to expose the manifest
let server = LocalServer()
server.start()

// Keep the runloop alive
RunLoop.main.run()
