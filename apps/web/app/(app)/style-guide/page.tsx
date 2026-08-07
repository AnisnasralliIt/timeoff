"use client";

import * as React from "react";
import {
  Avatar,
  Badge,
  BalanceRing,
  Button,
  Card,
  CardContent,
  Checkbox,
  DateRangePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@timeoff/ui";
import {
  CalendarDays,
  ChevronDown,
  Heart,
  Info,
  MessageSquare,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
const swatches = (prefix: string, steps: number[]) =>
  steps.map((n: (typeof steps)[number]) => ({ name: `${prefix}-${n}`, value: `var(--${prefix}-${n})` }));

const SCALES = {
  Lagoon: swatches("lagoon", [
    50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950,
  ]),
  Sand: swatches("sand", [
    50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950,
  ]),
};

const SEMANTIC = [
  ["primary", "var(--primary)"],
  ["secondary", "var(--secondary)"],
  ["muted", "var(--muted)"],
  ["success", "var(--success)"],
  ["warning", "var(--warning)"],
  ["destructive", "var(--danger-500)"],
  ["info", "var(--info-600)"],
  ["border", "var(--border)"],
  ["ring", "var(--ring)"],
] as const;

const LEAVE_TONES = [
  ["vacation", "var(--leave-vacation)"],
  ["sick", "var(--leave-sick)"],
  ["parental", "var(--leave-parental)"],
  ["bereavement", "var(--leave-bereavement)"],
  ["unpaid", "var(--leave-unpaid)"],
  ["remote", "var(--leave-remote)"],
  ["custom", "var(--leave-custom)"],
  ["special", "var(--leave-special)"],
] as const;

const TYPE_SCALE = [
  ["xs", "12px", "text-xs"],
  ["sm", "13px", "text-[13px]"],
  ["base", "14px", "text-sm"],
  ["lg", "16px", "text-base"],
  ["xl", "20px", "text-xl"],
  ["2xl", "24px", "text-2xl"],
  ["3xl", "30px", "text-3xl"],
  ["4xl", "38px", "text-4xl"],
] as const;

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <Card>
        <CardContent className="p-6">{children}</CardContent>
      </Card>
    </section>
  );
}

export default function StyleGuidePage() {
  return (
    <div className="space-y-12 pb-24">
      <div className="space-y-3">
        <Badge variant="primary" className="gap-1.5">
          <Sparkles className="size-3" />
          Design system
        </Badge>
        <h1 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">
          Sea, sand, and a little warmth.
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
          The TimeOff design system — lagoon teal over warm sand, a serif for
          numbers that deserve attention, and motion that means something.
          Every surface here is token-driven and ships in light and dark.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SEMANTIC.map(([name, value]) => (
          <div
            key={name}
            className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
          >
            <div
              className="size-10 rounded-md shadow-sm"
              style={{ background: value }}
            />
            <div className="leading-tight">
              <p className="text-sm font-medium text-foreground">{name}</p>
              <p className="font-mono text-xs text-muted-foreground">{value}</p>
            </div>
          </div>
        ))}
      </div>

      <Section title="Brand scales" description="Full ramp, theme-agnostic.">
        <div className="grid gap-8 md:grid-cols-2">
          {Object.entries(SCALES).map(([name, colors]) => (
            <div key={name} className="space-y-2">
              <p className="text-sm font-medium text-foreground">{name}</p>
              {colors.map((c: (typeof colors)[number]) => (
                <div key={c.name} className="flex items-center gap-3">
                  <div
                    className="h-8 flex-1 rounded-md border border-border"
                    style={{ background: c.value }}
                  />
                  <span className="w-20 font-mono text-xs text-muted-foreground">
                    {c.name}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Leave-type palette"
        description="Categorical colors for calendars and badges — hue-distant, never the sole signal."
      >
        <div className="flex flex-wrap gap-6">
          {LEAVE_TONES.map(([name, value]) => (
            <div key={name} className="flex flex-col items-center gap-2">
              <div
                className="size-10 rounded-full shadow-sm"
                style={{ background: value }}
              />
              <span className="text-xs capitalize text-muted-foreground">
                {name}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <div className="space-y-6">
          <div className="space-y-2 border-b border-border pb-6">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Display — Fraunces
            </p>
            <p className="font-display text-4xl font-semibold leading-tight tracking-tight text-foreground">
              Twenty-three days left. Make them count.
            </p>
            <p className="font-display text-2xl font-medium text-foreground">
              The quietest part of your week is earned.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {TYPE_SCALE.map(([name, px, cls]) => (
              <div key={name} className="flex items-baseline gap-3">
                <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">
                  {px}
                </span>
                <span className={cls}>The quick sand fox</span>
              </div>
            ))}
          </div>
          <div className="flex items-baseline gap-3">
            <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">
              nums
            </span>
            <span className="text-sm tabular-nums text-foreground">
              0123456789 · 30 days · €12,480
            </span>
          </div>
        </div>
      </Section>

      <Section
        title="Buttons"
        description="Primary for the one action, subtle everything else. Active state nudges."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="destructive-subtle">Destructive subtle</Button>
          <Button variant="link">Link</Button>
        </div>
        <Separator className="my-5" />
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" aria-label="Add">
            <Plus />
          </Button>
          <Button variant="outline">
            <CalendarDays /> Pick dates
          </Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">Neutral</Badge>
          <Badge variant="primary">Primary</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="danger">Danger</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="outline">Outline</Badge>
        </div>
        <Separator className="my-5" />
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Leave-type tones
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {LEAVE_TONES.map(([name]) => (
            <Badge key={name} tone={name as never}>
              {name}
            </Badge>
          ))}
        </div>
        <Separator className="my-5" />
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Status mapping
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">Pending</Badge>
          <Badge variant="success">Approved</Badge>
          <Badge variant="danger">Rejected</Badge>
          <Badge variant="neutral">Cancelled</Badge>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid gap-6 md:grid-cols-2">
          <Field label="Full name" required id="sg-name">
            <Input id="sg-name" placeholder="Ada Lovelace" />
          </Field>
          <Field label="Email" hint="Work email, used for notifications." id="sg-email">
            <Input id="sg-email" type="email" placeholder="ada@company.com" />
          </Field>
          <Field
            label="Leave type"
            id="sg-type"
            hint="Pick the type that applies."
          >
            <Select defaultValue="vacation">
              <SelectTrigger id="sg-type" className="w-full">
                <SelectValue placeholder="Select a type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vacation">Vacation</SelectItem>
                <SelectItem value="sick">Sick leave</SelectItem>
                <SelectItem value="parental">Parental</SelectItem>
                <SelectItem value="unpaid">Unpaid</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Reason" id="sg-reason" error="Reason is required.">
            <Textarea id="sg-reason" placeholder="Where are you headed?" />
          </Field>
          <div className="flex items-center gap-3">
            <Checkbox id="sg-check" />
            <LabelDemo htmlFor="sg-check">Notify my manager</LabelDemo>
          </div>
          <div className="flex items-center gap-3">
            <Switch id="sg-switch" />
            <LabelDemo htmlFor="sg-switch">Automatic approval</LabelDemo>
          </div>
        </div>
      </Section>

      <Section
        title="Date range picker"
        description="Two-tap date selection with hover preview and range footer."
      >
        <div className="flex flex-wrap items-center gap-3">
          <DateRangePicker placeholder="Choose your dates" />
          <DateRangePicker mode="single" placeholder="Single day" />
        </div>
      </Section>

      <Section title="Avatars & presence">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name="Ada Lovelace" size="sm" />
          <Avatar name="Grace Hopper" />
          <Avatar name="Alan Turing" size="lg" />
          <Avatar name="Katherine Johnson" out />
          <Avatar name="Margaret Hamilton" size="lg" out />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          The teal ring + dot marks someone on approved leave.
        </p>
      </Section>

      <Section title="Feedback">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Balance ring
              </p>
              <BalanceRing
                value={0.62}
                size={140}
                center={
                  <>
                    <span className="font-display text-2xl font-semibold tabular-nums">
                      38%
                    </span>
                    <span className="text-xs text-muted-foreground">remaining</span>
                  </>
                }
              />
            </div>
            <div className="space-y-3">
              <Progress value={62} />
              <Progress value={20} className="text-success" />
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={() => toast("Request submitted", {
                  description: "Ada has been notified and can approve it.",
                  action: { label: "Undo", onClick: () => {} },
                })}
              >
                Toast
              </Button>
              <Button
                variant="destructive-subtle"
                onClick={() =>
                  toast.error("Out of balance", {
                    description: "This request would exceed your vacation balance.",
                  })
                }
              >
                Error toast
              </Button>
            </div>
          </div>
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-8 w-1/3" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline">Hover me</Button>
              </TooltipTrigger>
              <TooltipContent>Calm, purposeful tooltips.</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm request</DialogTitle>
                <DialogDescription>
                  Sending this will notify your manager. You can edit it any
                  time before it is approved.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2 rounded-md bg-muted p-3 text-sm">
                <Info className="size-4 text-info" />
                10 business days · Aug 17 – Aug 28
              </div>
              <DialogFooter>
                <Button variant="ghost">Keep editing</Button>
                <Button>Submit request</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open drawer</Button>
            </DialogTrigger>
            <DialogContent side>
              <DialogHeader>
                <DialogTitle>Request details</DialogTitle>
                <DialogDescription>
                  Full approval trail for this leave request.
                </DialogDescription>
              </DialogHeader>
              <div className="flex-1 space-y-4 text-sm">
                <div className="rounded-md border border-border p-4">
                  <p className="font-medium">Aug 17 – Aug 28</p>
                  <p className="text-muted-foreground">Vacation · 10 days</p>
                </div>
                <div className="space-y-3">
                  {["Submitted by Ada", "Approved by Grace", "Synced to calendar"].map(
                    (s: string, i: number) => (
                      <div key={s} className="flex items-center gap-3">
                        <div className="flex size-6 items-center justify-center rounded-full bg-primary-subtle text-xs font-medium text-primary-subtle-foreground">
                          {i + 1}
                        </div>
                        <p className="text-muted-foreground">{s}</p>
                      </div>
                    )
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="destructive-subtle">
                  <Trash2 /> Cancel request
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                Menu <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Request actions</DropdownMenuLabel>
              <DropdownMenuItem>
                <MessageSquare /> Add comment
              </DropdownMenuItem>
              <DropdownMenuItem>
                <CalendarDays /> View on calendar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive>
                <Trash2 /> Cancel request
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="calendar">
          <TabsList>
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="coverage">Coverage</TabsTrigger>
          </TabsList>
          <TabsContent value="calendar">
            <EmptyState
              icon={<CalendarDays />}
              title="Nothing planned yet"
              description="Approved time off will appear here. Suggest the first one?"
              action={<Button size="sm"><Plus /> New request</Button>}
            />
          </TabsContent>
          <TabsContent value="list">
            <p className="text-sm text-muted-foreground">
              List view ships with the team calendar in Stage 4.
            </p>
          </TabsContent>
          <TabsContent value="coverage">
            <p className="text-sm text-muted-foreground">
              Coverage heatmap lands with the manager flow.
            </p>
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Empty state">
        <div className="flex flex-wrap gap-6">
          <div className="w-full max-w-md">
            <EmptyState
              icon={<Heart />}
              title="No leave on record"
              description="Once you book your first days off, they’ll show up here with your full approval trail."
              action={<Button size="sm"><Plus /> Request time off</Button>}
            />
          </div>
        </div>
      </Section>
    </div>
  );
}

function LabelDemo(props: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      htmlFor={props.htmlFor}
      className="text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
    >
      {props.children}
    </label>
  );
}
