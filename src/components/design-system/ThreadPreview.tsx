// A chat turn around the ArtifactBlock (the assistant's message, the block,
// then the composer), built from primitives only, so a reskin shows every
// primitive in the context it will live in. Sample content, not real data.

import React from 'react'
import { ArtifactBlock } from './ArtifactBlock'
import { Button, Input, Stack, Text } from './primitives'

export interface ThreadPreviewProps {
  onOpen?: () => void
  onViewHistory?: () => void
}

export function ThreadPreview({ onOpen, onViewHistory }: ThreadPreviewProps) {
  return (
    <Stack gap="lg">
      <Stack gap="md">
        <Text variant="caption" tone="muted" uppercase>
          Sample conversation
        </Text>
        <Text variant="body">
          I drafted the quarterly letter from last week’s partner notes. It covers revenue, the two new hires and the
          open questions on pricing.
        </Text>
        <ArtifactBlock
          title="Q3 Letter to Partners"
          meta="Document · Saved 2 min ago"
          draftVersion={2}
          onOpen={onOpen}
          onViewHistory={onViewHistory}
        />
      </Stack>
      <form onSubmit={(e) => e.preventDefault()}>
        <Stack direction="row" gap="sm" align="end">
          <Input label="Reply" placeholder="Ask for a revision…" />
          <Button type="submit">Send</Button>
        </Stack>
      </form>
    </Stack>
  )
}
