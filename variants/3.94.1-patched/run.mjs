// Runs one measurement against the payload version installed in this folder.
// The code is shared (../../src); only the modules it is given differ.
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import * as payload from 'payload'
import * as payloadInternal from 'payload/internal'

import { runVariant } from '../../src/runVariant.mjs'

await runVariant({ payload, payloadInternal, sqliteAdapter, variantDir: import.meta.dirname })
