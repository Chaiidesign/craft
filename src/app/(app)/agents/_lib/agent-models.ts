/** Friendly label for a model id by naming convention; null when the id is opaque. */
export function modelDisplayName(modelId: string | null): string | null {
  if (!modelId) return null
  const id = modelId.toLowerCase()
  if (id.includes('claude')) {
    if (id.includes('opus')) return 'Advanced'
    return 'Standard'
  }
  if (id.includes('gpt')) return (id.includes('3.5') || id.includes('3-5')) ? 'GPT-3.5' : 'GPT-4'
  if (id.includes('gemini'))  return 'Gemini'
  if (id.includes('llama'))   return 'Llama'
  if (id.includes('mistral')) return 'Mistral'
  // Backend model ids are opaque UUIDs, not slugs — none of the checks above
  // can ever match one, so this must never fall through to the raw id itself
  // (that's the literal bug that shows a UUID in the model badge).
  return null
}

/** Display name for a persona's model: the catalog name first, the naming-convention label as fallback. */
export function resolveModelName(modelIdToName: Map<string, string>, modelId: string | null): string | null {
  if (!modelId) return null
  return modelIdToName.get(modelId) ?? modelDisplayName(modelId)
}
