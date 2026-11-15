// Every message each CoreMIDI source sends, decoded, for the given seconds (default 90)
// (plan issue V507; .ai/repo/workflows/midi-device-import.md step 4). macOS only; reads, never
// sends to a device. A virtual source "osc-selftest" sends one Note On at start, proving the
// listener before a device is played. Clock (F8) and active sensing (FE) are not printed.
//
//   swift scripts/midi/listen.swift [seconds]
import CoreMIDI
import Foundation
setvbuf(stdout, nil, _IONBF, 0)
func name(_ o: MIDIObjectRef) -> String {
  var s: Unmanaged<CFString>?
  MIDIObjectGetStringProperty(o, kMIDIPropertyDisplayName, &s)
  return (s?.takeRetainedValue() as String?) ?? "?"
}
let names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
func note(_ n: UInt8) -> String { "\(names[Int(n) % 12])\(Int(n) / 12 - 1)" }
var client = MIDIClientRef()
MIDIClientCreate("osc-listen" as CFString, nil, nil, &client)
var count = 0
var vsrc = MIDIEndpointRef()
MIDISourceCreate(client, "osc-selftest" as CFString, &vsrc)
let start = Date()
for i in 0..<MIDIGetNumberOfSources() {
  let src = MIDIGetSource(i)
  let label = name(src)
  var port = MIDIPortRef()
  MIDIInputPortCreateWithBlock(client, "in-\(i)" as CFString, &port) { list, _ in
    var p = list.pointee.packet
    for _ in 0..<list.pointee.numPackets {
      let bytes = withUnsafeBytes(of: p.data) { Array($0.prefix(Int(p.length))) }
      var j = 0
      while j < bytes.count {
        let st = bytes[j]
        if st == 0xF8 || st == 0xFE { j += 1; continue }
        let hi = st & 0xF0, ch = Int(st & 0x0F) + 1
        let t = String(format: "%6.2fs", Date().timeIntervalSince(start))
        var len = 3
        var msg = ""
        switch hi {
        case 0x90 where j + 2 < bytes.count:
          msg = bytes[j+2] == 0 ? "note-off \(note(bytes[j+1]))" : "note-on  \(note(bytes[j+1])) vel=\(bytes[j+2])"
        case 0x80 where j + 2 < bytes.count: msg = "note-off \(note(bytes[j+1])) vel=\(bytes[j+2])"
        case 0xB0 where j + 2 < bytes.count: msg = "CC\(bytes[j+1])=\(bytes[j+2])"
        case 0xE0 where j + 2 < bytes.count: msg = "pitchbend \(Int(bytes[j+2]) << 7 | Int(bytes[j+1]))"
        case 0xD0 where j + 1 < bytes.count: msg = "aftertouch \(bytes[j+1])"; len = 2
        case 0xC0 where j + 1 < bytes.count: msg = "program \(bytes[j+1])"; len = 2
        default: msg = "raw " + bytes[j...].map { String(format: "%02X", $0) }.joined(separator: " "); len = bytes.count - j
        }
        count += 1
        print("\(t) [\(label)] ch\(ch) \(msg)")
        j += len
      }
      p = MIDIPacketNext(&p).pointee
    }
  }
  MIDIPortConnectSource(port, src, nil)
  print("listening: \(label)")
}
DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
  var pl = MIDIPacketList(); let pk = MIDIPacketListInit(&pl)
  let b: [UInt8] = [0x90, 60, 100]
  _ = MIDIPacketListAdd(&pl, 1024, pk, 0, 3, b)
  MIDIReceived(vsrc, &pl)
}
let seconds = CommandLine.arguments.count > 1 ? Double(CommandLine.arguments[1]) ?? 90 : 90
print("PLAY NOW (\(Int(seconds)) s)")
RunLoop.main.run(until: Date().addingTimeInterval(seconds))
print("done, \(count) message(s)")
