# Jalali Date Picker Usage Guide

## Import

```tsx
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
```

## Basic Usage

```tsx
<JalaliDatePicker 
  name="date"
  label="تاریخ"
  required
/>
```

## With Default Value

```tsx
<JalaliDatePicker 
  name="issueDate"
  label="تاریخ صدور"
  defaultValue={new Date()}
  required
/>
```

## With onChange Handler

```tsx
<JalaliDatePicker 
  name="dueDate"
  label="تاریخ سررسید"
  onChange={(date) => console.log('Selected:', date)}
/>
```

## In Forms

Use it exactly like a normal input in your forms:

```tsx
<form action={dispatch}>
  <JalaliDatePicker 
    name="transactionDate"
    label="تاریخ تراکنش"
    defaultValue={initialData?.date}
    required
  />
  
  <JalaliDatePicker 
    name="paymentDate"
    label="تاریخ پرداخت"
  />
  
  <Button type="submit">ثبت</Button>
</form>
```

## Features

- ✅ Persian/Jalali calendar display
- ✅ Month/year navigation in Persian
- ✅ "Today" button (امروز)
- ✅ Visual indication of current day
- ✅ Highlights selected date
- ✅ Integrated with shadcn/ui components
- ✅ Hidden ISO date input for form submission
- ✅ Fully RTL compatible
- ✅ Keyboard accessible

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `name` | string | required | Form field name |
| `label` | string | optional | Label text |
| `defaultValue` | Date \| string \| null | null | Initial date value |
| `onChange` | (date: Date \| null) => void | optional | Callback on date select |
| `required` | boolean | false | Make field required |
| `disabled` | boolean | false | Disable the picker |
| `className` | string | optional | Additional CSS classes |
| `placeholder` | string | 'انتخاب تاریخ...' | Placeholder text |
