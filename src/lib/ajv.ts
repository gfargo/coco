import Ajv from 'ajv'

export const ajv = new Ajv({
  allErrors: true,
  verbose: true,
  strictTypes: false,
})
