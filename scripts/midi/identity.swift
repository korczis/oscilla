// The Universal SysEx Identity Request (F0 7E 7F 06 01 F7, MIDI 1.0 non-real-time 06 01) to
// every CoreMIDI destination, and every SysEx reply for 3 s (plan issue V507;
// .ai/repo/workflows/midi-device-import.md step 3). macOS only. The request only asks a device
// to name itself and changes nothing on it. A reply reads F0 7E <device> 06 02 <manufacturer
// (1 or 3 bytes)> <family, 2 bytes> <member, 2 bytes> <version, 4 bytes least significant first>
// F7; the profile's identity numbers (src/data/midi-devices.json) are compared with it.
//
//   swift scripts/midi/identity.swift
import CoreMIDI
import Foundation
var client = MIDIClientRef(); MIDIClientCreate("osc-id" as CFString, nil, nil, &client)
var inPort = MIDIPortRef()
func name(_ e: MIDIEndpointRef) -> String {
  var s: Unmanaged<CFString>?; MIDIObjectGetStringProperty(e, kMIDIPropertyDisplayName, &s)
  return (s?.takeRetainedValue() as String?) ?? "?"
}
MIDIInputPortCreateWithBlock(client, "in" as CFString, &inPort) { list, src in
  var p = list.pointee.packet
  for _ in 0..<list.pointee.numPackets {
    let bytes = withUnsafeBytes(of: p.data) { Array($0.prefix(Int(p.length))) }
    if bytes.first == 0xF0 || bytes.contains(0xF0) {
      let from = src.map { name(MIDIEndpointRef(UInt32(Int(bitPattern: $0)))) } ?? "?"
      print(from, bytes.map { String(format: "%02X", $0) }.joined(separator: " "))
    }
    p = MIDIPacketNext(&p).pointee
  }
}
for i in 0..<MIDIGetNumberOfSources() {
  let s = MIDIGetSource(i)
  MIDIPortConnectSource(inPort, s, UnsafeMutableRawPointer(bitPattern: Int(s)))
}
var outPort = MIDIPortRef(); MIDIOutputPortCreate(client, "out" as CFString, &outPort)
let req: [UInt8] = [0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7]
for i in 0..<MIDIGetNumberOfDestinations() {
  let d = MIDIGetDestination(i)
  print("ask", name(d))
  var pl = MIDIPacketList(); let pk = MIDIPacketListInit(&pl)
  _ = MIDIPacketListAdd(&pl, 1024, pk, 0, req.count, req)
  MIDISend(outPort, d, &pl)
}
RunLoop.main.run(until: Date().addingTimeInterval(3))
