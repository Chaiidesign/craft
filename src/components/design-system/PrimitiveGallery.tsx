// Every primitive in every variant, for the demo route and the tokens-only tests.

import React from 'react'
import { Badge, Button, Card, DocumentGlyph, IconFrame, Input, Stack, Text } from './primitives'

export function PrimitiveGallery() {
  return (
    <Stack gap="lg">
      <Stack gap="sm">
        <Text as="h3" variant="title">Title text</Text>
        <Text variant="body">Body text sets the reading voice of the system.</Text>
        <Text variant="body" tone="muted">Muted body text for secondary lines.</Text>
        <Text variant="caption" tone="muted">Caption text · metadata</Text>
        <Text variant="label" tone="primary" uppercase>Label text</Text>
      </Stack>
      <Stack direction="row" gap="sm" wrap align="center">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button disabled>Disabled</Button>
        <Badge>Badge</Badge>
      </Stack>
      <Input label="Text field" placeholder="Placeholder text" />
      <Stack direction="row" gap="md" wrap>
        <Card padding="md">
          <Stack direction="row" gap="md" align="center">
            <IconFrame><DocumentGlyph /></IconFrame>
            <Text variant="body">Card surface</Text>
          </Stack>
        </Card>
        <Card padding="md" elevation="raised">
          <Text variant="body">Raised card</Text>
        </Card>
      </Stack>
    </Stack>
  )
}
