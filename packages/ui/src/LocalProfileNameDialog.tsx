import { useId, useRef, useState } from "react";
import mark from "@/assets/two-code-mark.png";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { PROFILE_NAME_LIMIT, saveLocalProfileName } from "@/hooks/useLocalProfileName.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function LocalProfileNameDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const { intl } = useZCodeIntl();
  const [draft, setDraft] = useState(name);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const count = Array.from(draft).length;
  const valid = draft.trim().length > 0 && count <= PROFILE_NAME_LIMIT;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="gap-6 rounded-3xl p-8 sm:max-w-120"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
          inputRef.current?.select();
        }}
      >
        <img src={mark} alt="" aria-hidden="true" className="size-12 rounded-xl" />
        <DialogHeader className="gap-2 text-left">
          <DialogTitle className="text-ui-xl font-semibold">
            {intl.formatMessage({ id: "localProfile.title" })}
          </DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: "localProfile.description" })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            try {
              saveLocalProfileName(draft);
              onClose();
            } catch {
              setFailed(true);
            }
          }}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between text-foreground-subtle">
              <label htmlFor={id}>{intl.formatMessage({ id: "localProfile.label" })}</label>
              <span id={`${id}-count`} className="tabular-nums">
                {count} / {PROFILE_NAME_LIMIT}
              </span>
            </div>
            <Input
              id={id}
              ref={inputRef}
              value={draft}
              autoComplete="off"
              className="h-12 rounded-xl"
              aria-describedby={`${id}-count${failed ? ` ${id}-error` : ""}`}
              aria-invalid={!valid || failed}
              onChange={(event) => {
                setDraft(event.target.value);
                setFailed(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
              }}
            />
            {failed ? (
              <p id={`${id}-error`} role="alert" className="text-ui-caption text-destructive">
                {intl.formatMessage({ id: "localProfile.saveFailed" })}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button type="submit" disabled={!valid} className="min-w-24">
              {intl.formatMessage({ id: "common.save" })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
