import Foundation
import Network

/// A tiny HTTP Server that listens on port 8080 and serves the hardware manifest.
/// Over USB, `pymobiledevice3` will forward this port to the Windows machine.
class LocalServer {
    var listener: NWListener?
    
    func start() {
        do {
            let port = NWEndpoint.Port(integerLiteral: 8080)
            let params = NWParameters.tcp
            listener = try NWListener(using: params, on: port)
            
            listener?.newConnectionHandler = { connection in
                connection.start(queue: .global())
                self.handleConnection(connection)
            }
            
            listener?.start(queue: .global())
            print("Listening on 8080...")
        } catch {
            print("Failed to start listener: \(error)")
        }
    }
    
    private func handleConnection(_ connection: NWConnection) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, isComplete, error in
            if let data = data, let request = String(data: data, encoding: .utf8) {
                if request.contains("GET /manifest") {
                    let manifest = MobileGestalt.shared.extractManifest()
                    let jsonData = try? JSONSerialization.data(withJSONObject: manifest, options: .prettyPrinted)
                    let jsonString = String(data: jsonData ?? Data(), encoding: .utf8) ?? "{}"
                    
                    let response = """
                    HTTP/1.1 200 OK\r
                    Content-Type: application/json\r
                    Access-Control-Allow-Origin: *\r
                    Connection: close\r
                    \r
                    \(jsonString)
                    """
                    
                    connection.send(content: response.data(using: .utf8), completion: .contentProcessed({ _ in
                        connection.cancel()
                    }))
                } else {
                    let response = "HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n"
                    connection.send(content: response.data(using: .utf8), completion: .contentProcessed({ _ in
                        connection.cancel()
                    }))
                }
            }
        }
    }
}
