"use client";

import { useActionState } from "react";
import { Input, Label, Select } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import {
  createSkillFromMarkdown,
  type SkillUploadState,
} from "@/app/(app)/customize/actions";

export function SkillUploadForm({ isAdmin }: { isAdmin: boolean }) {
  const [state, action] = useActionState<SkillUploadState, FormData>(
    createSkillFromMarkdown,
    {},
  );
  return (
    <form action={action} className="space-y-3">
      <div>
        <Label htmlFor="skillMd">SKILL.md</Label>
        <input
          id="skillMd"
          name="skillMd"
          type="file"
          accept=".md,text/markdown,text/plain"
          required
          className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100 dark:text-neutral-300"
        />
        <p className="mt-1 text-xs text-neutral-400">
          A markdown file with YAML frontmatter (<code>name</code>,{" "}
          <code>description</code>) and the instructions as the body — same
          format Claude uses for Skills.
        </p>
      </div>
      <div>
        <Label htmlFor="referenceFiles">Reference files (optional)</Label>
        <input
          id="referenceFiles"
          name="referenceFiles"
          type="file"
          multiple
          className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-neutral-700 hover:file:bg-neutral-200 dark:text-neutral-300"
        />
        <p className="mt-1 text-xs text-neutral-400">
          Supporting docs/templates the skill refers to. Stored for download;
          not injected into every chat. Max 5 MB each.
        </p>
      </div>
      <div>
        <Label htmlFor="name">Name override (optional)</Label>
        <Input id="name" name="name" placeholder="Defaults to SKILL.md's name" />
      </div>
      <div>
        <Label htmlFor="description">Description override (optional)</Label>
        <Input id="description" name="description" />
      </div>
      <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
        <input type="checkbox" name="defaultActive" defaultChecked />
        Active by default
      </label>
      {isAdmin && (
        <div>
          <Label htmlFor="scope">Visibility</Label>
          <Select id="scope" name="scope" defaultValue="personal" className="h-10 w-full">
            <option value="personal">Personal (only me)</option>
            <option value="org">Org-wide (everyone)</option>
          </Select>
        </div>
      )}
      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </p>
      )}
      <SubmitButton pendingText="Uploading…">Upload skill</SubmitButton>
    </form>
  );
}
