// Generates a Payload config from three numbers, so the size of the permissions tree can be
// turned up and down:
//
//   collections     how many content collections (plus `users`)
//   blocks          how many blocks each collection's `layout` blocks field offers
//   fieldsPerBlock  how many fields each block has
//
// mode 'inline'     every collection lists the same block objects inline in `blocks`
// mode 'references' the blocks live once in the config's `blocks` and every collection
//                   points at them with `blockReferences` (the "shared block references" case)
//
// Blocks are also reused inside one collection, so every path that hands out a block's
// permissions more than once is exercised: a second blocks field, `sidebar`, offers the first
// three blocks again (a second occurrence at the top level of the same collection), and
// block-0 has a nested blocks field, `inner`, that offers block-1 (an occurrence inside a block).
//
// Access is realistic in shape: collection-level functions for every operation, field-level
// functions on some fields, and a field that nobody may update, so the sanitized tree is not
// just `true` everywhere. Every function is synchronous and returns a boolean for an admin.

const isAdmin = ({ req }) => Boolean(req.user?.roles?.includes('admin'))
const isLoggedIn = ({ req }) => Boolean(req.user)
const nobody = () => false

const collectionAccess = {
  create: isAdmin,
  delete: isAdmin,
  read: isLoggedIn,
  readVersions: isAdmin,
  update: isAdmin,
}

const blockField = (b, f) => {
  const name = `b${b}f${f}`
  switch (f % 4) {
    case 0:
      return { name, type: 'text' }
    case 1:
      return { name, type: 'textarea', access: { read: isLoggedIn, update: isAdmin } }
    case 2:
      return { name, type: 'checkbox', access: { create: isAdmin, update: isAdmin } }
    default:
      return { name, type: 'number', access: { update: nobody } }
  }
}

const blocksField = (name, mode, blockList) =>
  mode === 'references'
    ? { name, type: 'blocks', blockReferences: blockList.map((b) => b.slug), blocks: [] }
    : { name, type: 'blocks', blocks: blockList }

export const makeBlocks = ({ blocks, fieldsPerBlock, mode }) => {
  const list = Array.from({ length: blocks }, (_, b) => ({
    slug: `block-${b}`,
    fields: Array.from({ length: fieldsPerBlock }, (_, f) => blockField(b, f)),
  }))
  if (list.length >= 2) list[0].fields.push(blocksField('inner', mode, [list[1]]))
  return list
}

export const makeCollections = ({ collections, mode, blockList }) =>
  Array.from({ length: collections }, (_, c) => ({
    slug: `collection-${c}`,
    access: collectionAccess,
    versions: { drafts: true },
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'internalNote', type: 'text', access: { read: isAdmin, update: isAdmin } },
      { name: 'computed', type: 'text', access: { create: nobody, update: nobody } },
      {
        name: 'meta',
        type: 'group',
        fields: [
          { name: 'description', type: 'textarea' },
          { name: 'noIndex', type: 'checkbox', access: { update: isAdmin } },
        ],
      },
      blocksField('layout', mode, blockList),
      blocksField('sidebar', mode, blockList.slice(0, 3)),
    ],
  }))

export const users = {
  slug: 'users',
  auth: true,
  access: { admin: isAdmin, create: isAdmin, delete: isAdmin, read: isLoggedIn, update: isAdmin },
  fields: [{ name: 'roles', type: 'select', hasMany: true, options: ['admin', 'editor'] }],
}

/**
 * @param {object} args
 * @param {(config: object) => Promise<object>} args.buildConfig  from the variant's `payload`
 * @param {(args: object) => object} args.sqliteAdapter           from the variant's `@payloadcms/db-sqlite`
 * @param {{collections: number, blocks: number, fieldsPerBlock: number, mode: 'inline' | 'references'}} args.shape
 * @param {string} args.dbFile
 */
export const generateConfig = ({ buildConfig, sqliteAdapter, shape, dbFile }) => {
  const blockList = makeBlocks(shape)
  return buildConfig({
    admin: { user: 'users' },
    ...(shape.mode === 'references' ? { blocks: blockList } : {}),
    collections: [users, ...makeCollections({ ...shape, blockList })],
    db: sqliteAdapter({ client: { url: `file:${dbFile}` } }),
    secret: process.env.PAYLOAD_SECRET,
    telemetry: false,
  })
}
