"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Dimension } from "@/lib/types";
import { loadDimensions, saveDimensions } from "@/lib/storage";

export function GrowthTracker() {
  const [dimensions, setDimensions] = useState<Dimension[] | null>(null);
  const [newDimensionName, setNewDimensionName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setDimensions(loadDimensions());
  }, []);

  function update(next: Dimension[]) {
    setDimensions(next);
    saveDimensions(next);
  }

  function addDimension() {
    if (!dimensions) return;
    const name = newDimensionName.trim();
    if (!name) return;
    update([
      ...dimensions,
      {
        id: crypto.randomUUID(),
        name,
        scripture: "",
        subheadings: [],
        notes: [],
      },
    ]);
    setNewDimensionName("");
  }

  function removeDimension(id: string) {
    if (!dimensions) return;
    update(dimensions.filter((d) => d.id !== id));
  }

  function setScripture(id: string, scripture: string) {
    if (!dimensions) return;
    update(dimensions.map((d) => (d.id === id ? { ...d, scripture } : d)));
  }

  function addNote(id: string) {
    if (!dimensions) return;
    const text = (drafts[id] ?? "").trim();
    if (!text) return;
    update(
      dimensions.map((d) =>
        d.id === id
          ? {
              ...d,
              notes: [
                {
                  id: crypto.randomUUID(),
                  text,
                  timestamp: new Date().toISOString(),
                },
                ...d.notes,
              ],
            }
          : d,
      ),
    );
    setDrafts({ ...drafts, [id]: "" });
  }

  function removeNote(dimensionId: string, noteId: string) {
    if (!dimensions) return;
    update(
      dimensions.map((d) =>
        d.id === dimensionId
          ? { ...d, notes: d.notes.filter((n) => n.id !== noteId) }
          : d,
      ),
    );
  }

  if (!dimensions) {
    return (
      <p className="text-center text-sm text-muted-foreground">Loading…</p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2">
        <Input
          value={newDimensionName}
          onChange={(e) => setNewDimensionName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addDimension()}
          placeholder="Add a growth dimension (e.g. Financial)"
        />
        <Button onClick={addDimension}>
          <Plus className="size-4" />
          Add
        </Button>
      </div>

      <Accordion multiple className="flex flex-col gap-3">
        {dimensions.map((dimension) => (
          <AccordionItem
            key={dimension.id}
            value={dimension.id}
            className="rounded-lg border px-4"
          >
            <AccordionTrigger className="text-base font-semibold">
              {dimension.name}
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-4">
              <Input
                value={dimension.scripture}
                onChange={(e) => setScripture(dimension.id, e.target.value)}
                placeholder="Anchor verse or guiding principle"
              />

              <div className="flex flex-col gap-2">
                <Textarea
                  value={drafts[dimension.id] ?? ""}
                  onChange={(e) =>
                    setDrafts({ ...drafts, [dimension.id]: e.target.value })
                  }
                  placeholder="What did you learn or notice today?"
                />
                <Button
                  variant="secondary"
                  className="self-end"
                  onClick={() => addNote(dimension.id)}
                >
                  Save note
                </Button>
              </div>

              {dimension.notes.map((note) => (
                <Card key={note.id}>
                  <CardHeader className="flex flex-row items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-sm font-medium">
                        {new Date(note.timestamp).toLocaleDateString(undefined, {
                          dateStyle: "medium",
                        })}
                      </CardTitle>
                      <CardDescription>
                        {new Date(note.timestamp).toLocaleTimeString(undefined, {
                          timeStyle: "short",
                        })}
                      </CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete note"
                      onClick={() => removeNote(dimension.id, note.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </CardHeader>
                  <CardContent className="whitespace-pre-wrap text-sm">
                    {note.text}
                  </CardContent>
                </Card>
              ))}

              <Button
                variant="ghost"
                className="self-start text-destructive"
                onClick={() => removeDimension(dimension.id)}
              >
                <Trash2 className="size-4" />
                Remove dimension
              </Button>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
