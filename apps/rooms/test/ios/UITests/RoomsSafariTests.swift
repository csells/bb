import XCTest

final class RoomsSafariTests: XCTestCase {
    @MainActor
    func testPersistentDrawerAndComposerInSafari() async throws {
        continueAfterFailure = false
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        let people = safari.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "People")).firstMatch
        XCTAssertTrue(people.waitForExistence(timeout: 30), safari.debugDescription)
        people.tap()
        let close = safari.buttons["Close panel"]
        XCTAssertTrue(close.waitForExistence(timeout: 10))
        XCTAssertTrue(safari.staticTexts["People in this room"].exists)
        attach(safari, name: "people-open")
        close.tap()
        people.tap()
        XCTAssertTrue(close.waitForExistence(timeout: 10))
        close.tap()
        safari.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Add agent")).firstMatch.tap()
        let name = safari.textFields["Name"]
        XCTAssertTrue(name.waitForExistence(timeout: 10), safari.debugDescription)
        name.tap()
        name.typeText("Temporary agent")
        attach(safari, name: "agent-drawer-keyboard")
        close.tap()
        let composer = safari.textViews["Message the room"]
        XCTAssertTrue(composer.waitForExistence(timeout: 10), safari.debugDescription)
        composer.tap()
        composer.typeText("Safari can type after closing the drawer.")
        safari.buttons["Send message"].tap()
        XCTAssertTrue(safari.staticTexts["Safari can type after closing the drawer."].waitForExistence(timeout: 10))
        attach(safari, name: "composer-after-drawer")
        let (data, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:38901/test/evidence")!)
        let result = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let audit = try XCTUnwrap(result["audit"] as? [[String: Any]])
        XCTAssertFalse(audit.isEmpty)
        XCTAssertTrue(audit.allSatisfy { $0["rootInert"] as? Bool == false && $0["rootHidden"] as? Bool == false })
        XCTAssertTrue(audit.allSatisfy { $0["sameDrawer"] as? Bool == true })
        XCTAssertTrue(audit.contains { $0["open"] as? Bool == true && $0["placeholder"] as? Bool == true && $0["realized"] as? Bool == false })
        XCTAssertTrue(audit.contains { $0["open"] as? Bool == true && $0["realized"] as? Bool == true })
        XCTAssertTrue(audit.contains { ($0["openCount"] as? Int ?? 0) >= 3 })
        XCTAssertTrue(audit.filter { $0["realized"] as? Bool == true }.allSatisfy { $0["overflow"] as? Bool == false })
        let messages = try XCTUnwrap(result["messages"] as? [[String: Any]])
        XCTAssertEqual(messages.last?["text"] as? String, "Safari can type after closing the drawer.")
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
