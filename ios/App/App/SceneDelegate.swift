import UIKit
import WebKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let bridgeVC = CAPBridgeViewController()
        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = bridgeVC
        window?.makeKeyAndVisible()

        if let view = bridgeVC.view {
            RippleLoadingOverlay.show(over: view, bridge: bridgeVC)
        }

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Black loading screen: the still friend-flower logo with a light ripple
/// travelling outward through its petals. It covers the web view until the
/// site has loaded (or a timeout passes), then fades away.
final class RippleLoadingOverlay: UIView {
    private static let minimumDuration: TimeInterval = 1.6
    private static let timeout: TimeInterval = 12

    private let shownAt = Date()
    private var loadingObservation: NSKeyValueObservation?
    private var didLoad = false
    private var dismissed = false
    private var logo: UIView?

    override func layoutSubviews() {
        super.layoutSubviews()
        logo?.center = CGPoint(x: bounds.midX, y: bounds.midY)
    }

    static func show(over host: UIView, bridge: CAPBridgeViewController) {
        let overlay = RippleLoadingOverlay(frame: host.bounds)
        overlay.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(overlay)
        NSLayoutConstraint.activate([
            overlay.topAnchor.constraint(equalTo: host.topAnchor),
            overlay.bottomAnchor.constraint(equalTo: host.bottomAnchor),
            overlay.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: host.trailingAnchor),
        ])
        overlay.watch(bridge)
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        isUserInteractionEnabled = true
        buildLogo()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    // MARK: Logo

    private func buildLogo() {
        let side: CGFloat = 220
        let logo = UIView(frame: CGRect(x: 0, y: 0, width: side, height: side))
        addSubview(logo)
        self.logo = logo

        let scale = side / 64
        let petals = RippleLoadingOverlay.petalsPath()

        func flowerLayer(strokeAlpha: CGFloat) -> CAShapeLayer {
            let layer = CAShapeLayer()
            layer.frame = logo.bounds
            layer.path = petals.copy(using: [CGAffineTransform(scaleX: scale, y: scale)])
            layer.fillColor = nil
            layer.strokeColor = UIColor.white.withAlphaComponent(strokeAlpha).cgColor
            layer.lineWidth = 2.6 * scale
            layer.lineCap = .round
            layer.lineJoin = .round
            return layer
        }

        // Still logo, dimmed so the passing light reads clearly.
        logo.layer.addSublayer(flowerLayer(strokeAlpha: 0.28))

        // The same logo at full brightness, revealed only through a moving ring.
        let bright = flowerLayer(strokeAlpha: 1)
        bright.shadowColor = UIColor.white.cgColor
        bright.shadowOpacity = 0.9
        bright.shadowRadius = 6
        bright.shadowOffset = .zero

        let ring = CAGradientLayer()
        ring.type = .radial
        ring.frame = logo.bounds
        ring.startPoint = CGPoint(x: 0.5, y: 0.5)
        ring.endPoint = CGPoint(x: 1.1, y: 1.1) // gradient radius reaches past the petal tips
        ring.colors = [UIColor.clear.cgColor, UIColor.white.cgColor, UIColor.clear.cgColor]
        ring.locations = [0, 0, 0]
        bright.mask = ring
        logo.layer.addSublayer(bright)

        // Centre dot, pulsing as each ripple leaves it.
        let dot = CAShapeLayer()
        let dotRadius = 3.4 * scale
        dot.path = UIBezierPath(ovalIn: CGRect(x: -dotRadius, y: -dotRadius, width: dotRadius * 2, height: dotRadius * 2)).cgPath
        dot.position = CGPoint(x: side / 2, y: side / 2)
        dot.fillColor = UIColor(red: 0.902, green: 0.659, blue: 0.741, alpha: 1).cgColor
        logo.layer.addSublayer(dot)

        let cycle: CFTimeInterval = 2.4
        let band = 0.22
        let steps = 24
        var frames: [[NSNumber]] = []
        for i in 0...steps {
            let centre = -band + (1 + 2 * band) * Double(i) / Double(steps)
            let lo = min(max(centre - band, 0), 1)
            let mid = min(max(centre, 0), 1)
            let hi = min(max(centre + band, 0), 1)
            frames.append([lo, mid, hi].map { NSNumber(value: $0) })
        }
        let sweep = CAKeyframeAnimation(keyPath: "locations")
        sweep.values = frames
        sweep.duration = cycle * 0.7
        sweep.timingFunction = CAMediaTimingFunction(name: .easeOut)

        let group = CAAnimationGroup()
        group.animations = [sweep]
        group.duration = cycle
        group.repeatCount = .infinity
        ring.add(group, forKey: "ripple")

        let pulse = CAKeyframeAnimation(keyPath: "transform.scale")
        pulse.values = [1, 1.35, 1]
        pulse.keyTimes = [0, 0.12, 0.5]
        pulse.duration = cycle
        pulse.repeatCount = .infinity
        dot.add(pulse, forKey: "pulse")
    }

    /// The five-petal flower from app/icon.svg, in its 64x64 coordinate space.
    private static func petalsPath() -> CGPath {
        let petal = CGMutablePath()
        petal.move(to: CGPoint(x: 32, y: 32))
        petal.addCurve(to: CGPoint(x: 23.2, y: 10.3), control1: CGPoint(x: 27.8, y: 26.5), control2: CGPoint(x: 23.2, y: 18.6))
        petal.addCurve(to: CGPoint(x: 32, y: 5.5), control1: CGPoint(x: 23.2, y: 5.6), control2: CGPoint(x: 28.2, y: 2.6))
        petal.addCurve(to: CGPoint(x: 40.8, y: 10.3), control1: CGPoint(x: 35.8, y: 2.6), control2: CGPoint(x: 40.8, y: 5.6))
        petal.addCurve(to: CGPoint(x: 32, y: 32), control1: CGPoint(x: 40.8, y: 18.6), control2: CGPoint(x: 36.2, y: 26.5))
        petal.closeSubpath()

        let all = CGMutablePath()
        for i in 0..<5 {
            let t = CGAffineTransform(translationX: 32, y: 32)
                .rotated(by: CGFloat(i) * 2 * .pi / 5)
                .translatedBy(x: -32, y: -32)
            all.addPath(petal, transform: t)
        }
        return all
    }

    // MARK: Dismissal

    private func watch(_ bridge: CAPBridgeViewController) {
        // The web view exists once the bridge view has loaded; poll briefly for it.
        attach(to: bridge, attempts: 40)
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.timeout) { [weak self] in
            self?.dismiss()
        }
    }

    private func attach(to bridge: CAPBridgeViewController, attempts: Int) {
        guard !dismissed else { return }
        guard let webView = bridge.webView else {
            guard attempts > 0 else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
                self?.attach(to: bridge, attempts: attempts - 1)
            }
            return
        }
        var sawLoading = webView.isLoading
        loadingObservation = webView.observe(\.isLoading, options: [.new]) { [weak self] web, _ in
            if web.isLoading {
                sawLoading = true
            } else if sawLoading {
                self?.pageDidLoad()
            }
        }
        if !webView.isLoading && webView.url != nil && webView.estimatedProgress >= 1 {
            pageDidLoad()
        }
    }

    private func pageDidLoad() {
        guard !didLoad else { return }
        didLoad = true
        let remaining = max(0, Self.minimumDuration - Date().timeIntervalSince(shownAt))
        DispatchQueue.main.asyncAfter(deadline: .now() + remaining + 0.2) { [weak self] in
            self?.dismiss()
        }
    }

    private func dismiss() {
        guard !dismissed else { return }
        dismissed = true
        loadingObservation = nil
        UIView.animate(withDuration: 0.45, animations: { self.alpha = 0 }, completion: { _ in
            self.removeFromSuperview()
        })
    }
}
