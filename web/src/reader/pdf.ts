// PDF.js, the engine that draws book pages inside Deskwork.
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjs }
export type PdfDoc = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>
export type PdfPage = Awaited<ReturnType<PdfDoc['getPage']>>

/** Text copied out of a PDF arrives broken across lines; join it back into sentences. */
export function tidySelection(raw: string) {
  return raw
    .replace(/-\n\s*/g, '')      // a word split across two lines
    .replace(/\s*\n\s*/g, ' ')   // line breaks inside a paragraph
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}
