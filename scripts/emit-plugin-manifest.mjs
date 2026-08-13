import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distributionRoot = join(repositoryRoot, 'dist')
const manifestName = 'in-progress.plugin.json'
const entry = 'index.html'
const packageMetadata = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
if (typeof packageMetadata.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageMetadata.version)) {
  throw new Error('package.json version is not plugin-manifest compatible')
}

async function filesWithin(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await filesWithin(absolute)))
    else if (entry.isFile()) files.push(relative(distributionRoot, absolute).split(sep).join('/'))
  }
  return files
}

const assets = (await filesWithin(distributionRoot))
  .filter((path) => path !== entry && path !== manifestName)
  .sort()
const html = await readFile(join(distributionRoot, entry), 'utf8')
const markup = html
  .replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>')
  .replace(/(<style\b[^>]*>)[\s\S]*?<\/style>/gi, '$1</style>')
const references = [...markup.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)].map((match) => match[1])
if (assets.length > 0 || references.length > 0) {
  throw new Error(
    `Plugin entry must be self-contained; emitted ${assets.length} external assets and ${references.length} asset references`,
  )
}

const manifest = {
  apiVersion: '1.0',
  id: 'turbo-prompt',
  name: 'Turbo Prompt',
  version: packageMetadata.version,
  description: 'Project-aware prompt composer for coding agents',
  entry,
  assets,
  icon: 'sparkles',
  capabilities: ['project.metadata', 'project.tree', 'project.readText'],
}

await writeFile(
  join(distributionRoot, manifestName),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
)
