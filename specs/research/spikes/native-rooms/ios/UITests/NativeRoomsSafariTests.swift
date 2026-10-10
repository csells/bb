import XCTest

final class NativeRoomsSafariTests: XCTestCase {
    let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")

    func screenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: safari.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func button(_ label: String) -> XCUIElement { safari.buttons[label].firstMatch }

    func scrollDrawerUp() {
        let start = safari.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.42))
        let end = safari.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.23))
        start.press(forDuration: 0.01, thenDragTo: end)
    }

    func testComposerPublishesAfterDrawer() throws {
        continueAfterFailure = false
        safari.activate()
        let address = safari.textFields["Address"].firstMatch
        XCTAssertTrue(address.waitForExistence(timeout: 15))
        address.tap()
        address.typeText("http://127.0.0.1:38920/rooms/31b2edb9-1a03-4561-8c6b-3335bf2af701?composer=" + String(Int(Date().timeIntervalSince1970)) + "\n")
        XCTAssertTrue(button("Room participants").waitForExistence(timeout: 40), safari.debugDescription)
        button("Room participants").tap()
        XCTAssertTrue(button("Close Room participants").waitForExistence(timeout: 10))
        button("Close Room participants").tap()
        let composer = safari.textViews["Message the room"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        let stamp = String(Int(Date().timeIntervalSince1970))
        for method in ["Send button"] {
            let message = "Actual iOS " + method + " " + stamp
            composer.tap()
            composer.typeText(message)
            if method == "Enter" {
                composer.typeText("\n")
            } else {
                if button("Done").exists { button("Done").tap() }
                button("Send message").tap()
            }
            let cleared = expectation(for: NSPredicate { _, _ in
                let value = composer.value as? String ?? ""
                return !value.contains(message)
            }, evaluatedWith: composer)
            wait(for: [cleared], timeout: 15)
            XCTAssertTrue(safari.staticTexts[message].firstMatch.waitForExistence(timeout: 10))
            screenshot("composer-published-" + method)
        }
    }

    func testPersistentNativeRoomDrawer() throws {
        continueAfterFailure = false
        safari.activate()
        let address = safari.textFields["Address"].firstMatch
        XCTAssertTrue(address.waitForExistence(timeout: 15), safari.debugDescription)
        address.tap()
        address.typeText("http://127.0.0.1:38920/rooms?ios=" + String(Int(Date().timeIntervalSince1970)) + "\n")
        let newRoom = button("New room")
        XCTAssertTrue(newRoom.waitForExistence(timeout: 40), safari.debugDescription)
        newRoom.tap()
        let name = safari.textFields["Room name"].firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 10), safari.debugDescription)
        let stamp = String(Int(Date().timeIntervalSince1970))
        let roomName = "iOS Safari room " + stamp
        name.tap()
        name.typeText(roomName)
        screenshot("01-native-room-drawer-keyboard")
        button("Close Create room").tap()
        newRoom.tap()
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        XCTAssertEqual(name.value as? String, roomName)
        button("Close Create room").tap()
        newRoom.tap()
        XCTAssertEqual(name.value as? String, roomName)
        let newSection = button("New section")
        scrollDrawerUp()
        newSection.tap()
        let sectionName = safari.textFields["New section name"].firstMatch
        XCTAssertTrue(sectionName.waitForExistence(timeout: 10))
        sectionName.tap()
        sectionName.typeText("iOS Safari section " + stamp)
        scrollDrawerUp()
        scrollDrawerUp()
        screenshot("02-section-action-with-keyboard")
        button("Add section").tap()
        XCTAssertTrue(button("New section").waitForExistence(timeout: 10))
        screenshot("02-native-room-section-created")
        let create = button("Create room")
        scrollDrawerUp()
        create.tap()
        XCTAssertTrue(safari.staticTexts[roomName].firstMatch.waitForExistence(timeout: 20), safari.debugDescription)
        screenshot("03-native-room-created")
        newRoom.tap()
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        let emptyValue = name.value as? String
        XCTAssertTrue(emptyValue == "" || emptyValue == "Design review", emptyValue ?? "missing")
        button("Close Create room").tap()
        button("Room participants").tap()
        XCTAssertTrue(button("Close Room participants").waitForExistence(timeout: 10))
        screenshot("04-native-participants-drawer")
        button("Close Room participants").tap()
        let composer = safari.textViews["Message the room"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 10), safari.debugDescription)
        composer.tap()
        let message = "Message from actual iOS Safari " + stamp
        composer.typeText(message)
        if button("Done").exists { button("Done").tap() }
        button("Send message").tap()
        let cleared = expectation(for: NSPredicate { _, _ in
            let value = composer.value as? String ?? ""
            return !value.contains(message)
        }, evaluatedWith: composer)
        wait(for: [cleared], timeout: 15)
        XCTAssertTrue(safari.staticTexts[message].firstMatch.waitForExistence(timeout: 20))
        screenshot("05-native-room-message")
        let completed = expectation(description: "DOM audit captured")
        URLSession.shared.dataTask(with: URL(string: "http://127.0.0.1:38920/__ios/evidence")!) { data, _, error in
            XCTAssertNil(error)
            do {
                let body = try JSONSerialization.jsonObject(with: XCTUnwrap(data)) as! [String: Any]
                let observations = body["observations"] as! [[String: Any]]
                XCTAssertGreaterThan(observations.count, 5)
                XCTAssertTrue(observations.allSatisfy { $0["rootInert"] as? Bool == false && $0["rootHidden"] is NSNull })
                let samples = observations.flatMap { observation -> [[String: Any]] in
                    let drawers = observation["drawers"] as? [[String: Any]] ?? []
                    return drawers.filter { $0["title"] as? String == "Create room" }.map { drawer in
                        var value = drawer
                        value["frame"] = observation["frame"]
                        value["time"] = observation["time"]
                        value["path"] = observation["path"]
                        return value
                    }
                }
                let placeholder = try XCTUnwrap(samples.first { $0["state"] as? String == "open" && $0["placeholder"] as? Bool == true })
                let realized = try XCTUnwrap(samples.first { $0["id"] as? Int == placeholder["id"] as? Int && $0["realized"] as? Bool == true })
                let frameGap = (realized["frame"] as! Int) - (placeholder["frame"] as! Int)
                let timeGap = (realized["time"] as! Double) - (placeholder["time"] as! Double)
                XCTAssertTrue(frameGap >= 2 || timeGap >= 120, "Content realized before double animation frame or fallback")
                let originalNodes = Set(samples.filter { $0["path"] as? String == "/rooms" }.compactMap { $0["id"] as? Int })
                XCTAssertEqual(originalNodes.count, 1, "Drawer node replaced before navigation")
                XCTAssertTrue(samples.contains { $0["state"] as? String == "closed" && $0["name"] as? String == roomName })
                XCTAssertTrue(observations.allSatisfy { ($0["scrollWidth"] as! Int) <= ($0["width"] as! Int) + 1 })
            } catch { XCTFail(String(describing: error)) }
            completed.fulfill()
        }.resume()
        wait(for: [completed], timeout: 10)
    }
}
