import UIKit
import Capacitor
#if canImport(GoogleSignIn)
import GoogleSignIn
#endif

// iOS 27 refuses to launch an app built with Xcode 27 unless it runs on scenes (Apple TN3187).
// This is Capacitor 8.5's template SceneDelegate (capacitorjs.com/docs/updating/8-5): it makes the
// window and the bridge in code, which is why Info.plist's scene manifest names no storyboard.
// With scenes, iOS delivers links the app is opened with here, not to the AppDelegate.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        // Google's sign-in sheet (`@capgo/capacitor-social-login`) can come back through the app's
        // Google URL scheme (Info.plist). Current iOS hands the answer straight to the sheet; this
        // catches the rest. Guarded so the app still builds if the module isn't visible here.
        #if canImport(GoogleSignIn)
        let rest = URLContexts.filter { !GIDSignIn.sharedInstance.handle($0.url) }
        #else
        let rest = URLContexts
        #endif
        if !rest.isEmpty {
            SceneDelegateProxy.shared.scene(scene, openURLContexts: rest)
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
