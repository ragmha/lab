import { analyzeEdits, demoEdits, parseEdits, type ImportedEdits } from './agent-edits'

type Request = { files?: File[]; demo?: boolean }
type Response =
  | { type: 'progress'; done: number; total: number }
  | { type: 'result'; analysis: ReturnType<typeof analyzeEdits> }
  | { type: 'error'; message: string }

const send = (message: Response) => postMessage(message)
self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    if (data.demo) {
      send({ type: 'result', analysis: analyzeEdits([parseEdits(demoEdits)]) })
      return
    }
    const files = data.files ?? []
    if (!files.length || files.length > 20) throw new Error('Choose between 1 and 20 files.')
    if (files.reduce((size, file) => size + file.size, 0) > 50 * 1024 * 1024) {
      throw new Error('The import limit is 50 MiB total. Import smaller sessions separately.')
    }
    const imports: ImportedEdits[] = []
    for (const [index, file] of files.entries()) {
      if (!/\.jsonl?$/i.test(file.name)) throw new Error(`File ${index + 1}: choose a .json or .jsonl file.`)
      if (file.size > 20 * 1024 * 1024) throw new Error(`File ${index + 1}: the per-file limit is 20 MiB.`)
      try { imports.push(parseEdits(await file.text(), index)) } catch (error) {
        throw new Error(`File ${index + 1}: ${error instanceof Error ? error.message : 'Import failed.'}`)
      }
      send({ type: 'progress', done: index + 1, total: files.length })
    }
    send({ type: 'result', analysis: analyzeEdits(imports) })
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : 'Could not analyze the import.' })
  }
}
