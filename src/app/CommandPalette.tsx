import { useCallback, useState, Fragment } from 'react'
import { useNavigate } from 'react-router'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { searchTools } from '@/lib/search'
import { categories, type ToolDef } from '@/tools/registry'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  const handleSelect = useCallback(
    (id: string) => {
      void navigate(`/tools/${id}`)
      onOpenChange(false)
    },
    [navigate, onOpenChange],
  )

  // Fuse-ranked results (or all tools when query is empty)
  const results = searchTools(query)

  // Group results by category, preserving Fuse's rank order within each group.
  // We iterate the flat ranked list once, collecting items per category while
  // keeping insertion (rank) order within each group.
  const groupedByCategory = (() => {
    const map = new Map<string, ToolDef[]>()
    for (const tool of results) {
      const group = map.get(tool.category)
      if (group) {
        group.push(tool)
      } else {
        map.set(tool.category, [tool])
      }
    }
    // Return groups sorted by the canonical category order from registry
    return categories
      .filter((cat) => map.has(cat))
      .map((cat) => ({ category: cat, tools: map.get(cat)! }))
  })()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Search tools</DialogTitle>
        <DialogDescription>
          Type to search for a tool. Use arrow keys to navigate, Enter to open.
        </DialogDescription>
      </DialogHeader>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
        {/*
          shouldFilter={false} — disable cmdk's built-in string filtering so that
          Fuse.js ranking and typo tolerance drive the result list instead.
        */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search tools..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No tools found.</CommandEmpty>

            {groupedByCategory.map((group, idx) => (
              <Fragment key={group.category}>
                {idx > 0 && <CommandSeparator />}
                <CommandGroup heading={group.category}>
                  {group.tools.map((tool) => (
                    <CommandItem
                      key={tool.id}
                      value={tool.id}
                      onSelect={handleSelect}
                    >
                      <span className="flex flex-col gap-0.5">
                        <span className="font-medium">{tool.title}</span>
                        <span className="text-xs text-muted-foreground line-clamp-1">
                          {tool.description}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </Fragment>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
