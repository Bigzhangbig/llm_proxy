import { existsSync } from 'fs'
import { mkdir, writeFile, readFile, rm, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { hashContent } from './downloader'

const TMP_DIR = join(tmpdir(), 'llm_proxy_fetch')

async function findMarkdownFile(dir: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = await findMarkdownFile(fullPath)
      if (found) return found
    } else if (entry.name.endsWith('.md')) {
      return fullPath
    }
  }
  return null
}

export async function extractWithMineru(html: string): Promise<string> {
  await mkdir(TMP_DIR, { recursive: true })

  const hash = hashContent(html)
  const htmlPath = join(TMP_DIR, `raw_${hash}.html`)
  const outDir = join(TMP_DIR, `out_${hash}`)

  await writeFile(htmlPath, html, 'utf-8')

  try {
    const isLarge = html.length >= 10 * 1024 * 1024
    const cmd = isLarge
      ? ['mineru-open-api', 'extract', htmlPath, '-f', 'html', '-o', outDir]
      : ['mineru-open-api', 'flash-extract', htmlPath, '-o', outDir]

    const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
    const exitCode = await proc.exited

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`MinerU exited with code ${exitCode}: ${stderr}`)
    }

    const mdPath = await findMarkdownFile(outDir)
    if (!mdPath) {
      throw new Error('MinerU produced no markdown output')
    }

    return await readFile(mdPath, 'utf-8')
  } finally {
    // Cleanup
    try { await rm(htmlPath, { force: true }) } catch {}
    try { await rm(outDir, { recursive: true, force: true }) } catch {}
  }
}
