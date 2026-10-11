// objcap — minimal Object Capture (RealityKit PhotogrammetrySession) CLI.
// Modelled on Apple's "HelloPhotogrammetry" sample.
//
// Build:
//   mkdir -p scripts/objcap/build
//   swiftc -O -parse-as-library scripts/objcap/main.swift -o scripts/objcap/build/objcap
//
// Run:
//   scripts/objcap/build/objcap <inputDir> <reduced|medium|full|preview|raw> <out1> [out2 ...] \
//       [--checkpoint <dir>] [--no-mask] [--unordered] [--normal-sensitivity]
//
//   Each output path becomes one .modelFile request at the given detail level.
//   Use a .usdz path for USDZ; a .obj path or a directory path (no extension)
//   asks for OBJ+MTL+textures (macOS 14+). Example:
//   scripts/objcap/build/objcap model/objcap/input reduced \
//       model/objcap/jawa-reduced.usdz model/objcap/jawa-reduced-obj/
//
// Defaults: sampleOrdering = .sequential, featureSensitivity = .high,
// object masking on. --checkpoint reuses alignment between runs (macOS 14+).

import Foundation
import RealityKit

@main
struct ObjCap {
    static func usage() -> Never {
        FileHandle.standardError.write("usage: objcap <inputDir> <reduced|medium|full|preview|raw> <out1> [out2 ...] [--checkpoint dir] [--no-mask] [--unordered] [--normal-sensitivity]\n".data(using: .utf8)!)
        exit(2)
    }

    static func log(_ s: String) {
        let t = String(format: "%8.1fs", Date().timeIntervalSince(start))
        print("[\(t)] \(s)")
        fflush(stdout)
    }

    nonisolated(unsafe) static var start = Date()

    static func main() async {
        var args = Array(CommandLine.arguments.dropFirst())
        var checkpoint: URL? = nil
        var mask = true
        var sequential = true
        var high = true
        var positional: [String] = []
        while !args.isEmpty {
            let a = args.removeFirst()
            switch a {
            case "--checkpoint":
                guard !args.isEmpty else { usage() }
                checkpoint = URL(fileURLWithPath: args.removeFirst(), isDirectory: true).absoluteURL.standardizedFileURL
            case "--no-mask": mask = false
            case "--unordered": sequential = false
            case "--normal-sensitivity": high = false
            default: positional.append(a)
            }
        }
        guard positional.count >= 3 else { usage() }
        let input = URL(fileURLWithPath: positional[0], isDirectory: true).absoluteURL.standardizedFileURL
        let detail: PhotogrammetrySession.Request.Detail
        switch positional[1] {
        case "preview": detail = .preview
        case "reduced": detail = .reduced
        case "medium": detail = .medium
        case "full": detail = .full
        case "raw": detail = .raw
        default: usage()
        }
        let outputs = positional[2...].map { p -> URL in
            let isDir = p.hasSuffix("/") || URL(fileURLWithPath: p).pathExtension.isEmpty
            return URL(fileURLWithPath: p, isDirectory: isDir).absoluteURL.standardizedFileURL
        }

        guard PhotogrammetrySession.isSupported else {
            log("PhotogrammetrySession is NOT supported on this machine")
            exit(1)
        }

        var config = PhotogrammetrySession.Configuration()
        config.sampleOrdering = sequential ? .sequential : .unordered
        config.featureSensitivity = high ? .high : .normal
        config.isObjectMaskingEnabled = mask
        if let checkpoint {
            try? FileManager.default.createDirectory(at: checkpoint, withIntermediateDirectories: true)
            config.checkpointDirectory = checkpoint
        }
        for o in outputs where o.hasDirectoryPath {
            try? FileManager.default.createDirectory(at: o, withIntermediateDirectories: true)
        }
        for o in outputs where !o.hasDirectoryPath {
            try? FileManager.default.createDirectory(at: o.deletingLastPathComponent(), withIntermediateDirectories: true)
        }

        log("input=\(input.path) detail=\(positional[1]) ordering=\(config.sampleOrdering) sensitivity=\(config.featureSensitivity) masking=\(mask) checkpoint=\(checkpoint?.path ?? "-")")
        let session: PhotogrammetrySession
        do {
            session = try PhotogrammetrySession(input: input, configuration: config)
        } catch {
            log("ERROR creating session: \(error)")
            exit(1)
        }

        let requests = outputs.map { PhotogrammetrySession.Request.modelFile(url: $0, detail: detail) }
        let waiter = Task { () -> Int32 in
            var failed = 0
            var lastPct = -1
            var lastStage = ""
            do {
                for try await output in session.outputs {
                    switch output {
                    case .processingComplete:
                        log("processingComplete")
                        return failed == outputs.count ? 1 : 0
                    case .requestProgress(let req, let frac):
                        let pct = Int(frac * 100)
                        if pct != lastPct { lastPct = pct; log("requestProgress \(pct)% \(describe(req))") }
                    case .requestProgressInfo(_, let info):
                        if let s = info.processingStage, "\(s)" != lastStage { lastStage = "\(s)"; log("stage \(s)") }
                    case .requestComplete(let req, let result):
                        log("requestComplete \(describe(req)) -> \(result)")
                    case .requestError(let req, let err):
                        failed += 1
                        log("requestError \(describe(req)): \(err)")
                    case .inputComplete:
                        log("inputComplete")
                    case .invalidSample(let id, let reason):
                        log("invalidSample id=\(id) reason=\(reason)")
                    case .skippedSample(let id):
                        log("skippedSample id=\(id)")
                    case .automaticDownsampling:
                        log("automaticDownsampling")
                    case .processingCancelled:
                        log("processingCancelled")
                        return 1
                    case .stitchingIncomplete:
                        log("stitchingIncomplete (some images could not be stitched)")
                    @unknown default:
                        log("unknown output \(output)")
                    }
                }
            } catch {
                log("outputs stream error: \(error)")
                return 1
            }
            return failed > 0 ? 1 : 0
        }

        do {
            try session.process(requests: requests)
        } catch {
            log("ERROR process(requests:): \(error)")
            exit(1)
        }
        let code = await waiter.value
        log("done, exit \(code)")
        exit(code)
    }

    static func describe(_ r: PhotogrammetrySession.Request) -> String {
        if case .modelFile(let url, let detail, _) = r { return "modelFile(\(url.lastPathComponent), \(detail))" }
        return "\(r)"
    }
}
