import Foundation
import CoreFoundation

/// Direct wrapper around libMobileGestalt.dylib
/// This works from within the app sandbox on iOS 17.4+ to read protected hardware serials!
class MobileGestalt {
    private typealias MGCopyAnswerFunc = @convention(c) (CFString) -> CFTypeRef?
    private var mgCopyAnswer: MGCopyAnswerFunc?

    static let shared = MobileGestalt()

    private init() {
        // Dynamically load libMobileGestalt
        let handle = dlopen("/usr/lib/libMobileGestalt.dylib", RTLD_GLOBAL | RTLD_LAZY)
        if handle != nil {
            let sym = dlsym(handle, "MGCopyAnswer")
            if sym != nil {
                mgCopyAnswer = unsafeBitCast(sym, to: MGCopyAnswerFunc.self)
            }
        }
    }

    func readString(_ key: String) -> String? {
        guard let mgCopyAnswer = mgCopyAnswer else { return nil }
        let answer = mgCopyAnswer(key as CFString)
        if let str = answer as? String {
            return str
        }
        if let data = answer as? Data {
            // Some keys (like battery serial) return raw bytes
            return String(data: data, encoding: .utf8) ?? data.map { String(format: "%02x", $0) }.joined()
        }
        return nil
    }

    func extractManifest() -> [String: Any] {
        return [
            "battery_serial": readString("BatterySerialNumber") ?? readString("SRNM") ?? "null",
            "display_panel_serial": readString("PanelSerialNumber") ?? readString("RawPanelSerialNumber") ?? "null",
            "coverglass_serial": readString("CoverglassSerialNumber") ?? "null",
            "touch_id_serial": readString("MesaSerialNumber") ?? "null",
            "face_id_serial": readString("PearlCameraSerialNumber") ?? "null",
            "front_camera_serial": readString("FrontFacingCameraModuleSerialNumber") ?? "null",
            "rear_camera_serial": readString("RearFacingCameraModuleSerialNumber") ?? "null",
            "baseband_serial": readString("BasebandSerialNumber") ?? "null"
        ]
    }
}
