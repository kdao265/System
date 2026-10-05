import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect } from "./fixtures";
import { rewardExp } from "./quest-helpers";
export function recurringRow(page: Page,title: string,archived=false){
  const scope=archived?page.getByRole("region",{name:"Archived Recurring Quests",exact:true}):page.getByRole("list",{name:"Recurring definitions",exact:true});
  return scope.getByRole("listitem").filter({has:page.getByRole("heading",{name:title,exact:true})});
}
export async function createRecurring(page: Page,schedule?:{start:string;end:string;nextDay?:boolean}){
  await page.getByRole("link",{name:"View today",exact:true}).click();
  const day=await page.getByLabel("Choose date",{exact:true}).inputValue();
  const title=`Retirement ${randomUUID()}`;
  const form=page.getByRole("region",{name:"Create Quest",exact:true});
  await form.getByLabel("Quest type",{exact:true}).selectOption("daily");
  await form.getByLabel("Title",{exact:true}).fill(title);
  await form.getByLabel("Reward EXP",{exact:true}).fill(String(rewardExp));
if(schedule){
    await form.getByLabel("Default start time",{exact:true}).fill(schedule.start);
    await form.getByLabel("Default end time",{exact:true}).fill(schedule.end);
    if(schedule.nextDay) await form.getByLabel("Ends the next day",{exact:true}).check();
  }
  await form.getByLabel("Start date",{exact:true}).fill(day);
  await form.getByRole("button",{name:"Create recurring Quest",exact:true}).click();
  await expect(recurringRow(page,title)).toBeVisible();return {title,day};
}
export async function retire(page: Page,title: string,operation: "archive"|"restore"|"delete"){
  const row=recurringRow(page,title,operation!=="archive");
  await row.getByRole("button",{name:operation==="delete"?"Delete permanently":operation==="archive"?"Archive":"Restore",exact:true}).click();
  if(operation==="delete"){
    await expect(row).toContainText("This series cannot be restored");
    await expect(row).toContainText("Future generation stops permanently");
    await expect(row).toContainText("all existing occurrences are permanently frozen");
    await expect(row).toContainText("Previously earned EXP and immutable history remain");
    await expect(row).toContainText("BEFORE permanent deletion");
  }
  await row.getByRole("button",{name:operation==="delete"?"Confirm permanent delete":operation==="archive"?"Confirm archive":"Confirm restore",exact:true}).click();
}

/**
 * A recurring definition that has ZERO materialized occurrences: the series ends
 * before the selected day, so no occurrence card exists to reach management from.
 * The definition row must still be able to open the shared Manage series manager.
 */
export async function createRecurringWithoutOccurrences(page: Page){
  await page.getByRole("link",{name:"View today",exact:true}).click();
  const day=await page.getByLabel("Choose date",{exact:true}).inputValue();
  // Anchor yesterday and end yesterday: the selected day is outside the series.
  const anchor=new Date(`${day}T12:00:00Z`);anchor.setUTCDate(anchor.getUTCDate()-1);
  const yesterday=anchor.toISOString().slice(0,10);
  const title=`Unmaterialized ${randomUUID()}`;
  const form=page.getByRole("region",{name:"Create Quest",exact:true});
  await form.getByLabel("Quest type",{exact:true}).selectOption("daily");
  await form.getByLabel("Title",{exact:true}).fill(title);
  await form.getByLabel("Start date",{exact:true}).fill(yesterday);
  await form.getByLabel("End date (optional)",{exact:true}).fill(yesterday);
  await form.getByRole("button",{name:"Create recurring Quest",exact:true}).click();
  await expect(recurringRow(page,title)).toBeVisible();
  // The series is listed but produced no occurrence for the selected day.
  await expect(page.getByRole("list",{name:"Quest occurrences",exact:true})
    .getByRole("listitem").filter({has:page.getByRole("heading",{name:title,exact:true})})).toHaveCount(0);
  return {title,day};
}

/** Opens the shared series manager from a recurring DEFINITION row, not an occurrence card. */
export async function openSeriesFromDefinition(page: Page,title: string){
  const action=recurringRow(page,title).getByRole("button",{name:"Manage series",exact:true});
  await expect(action).toBeVisible();
  await action.click();
  const dialog=page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName("Series management");
  return dialog;
}
