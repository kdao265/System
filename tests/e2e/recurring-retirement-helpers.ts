import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect } from "./fixtures";
import { rewardExp } from "./quest-helpers";
export function recurringRow(page: Page,title: string,archived=false){
  const scope=archived?page.getByRole("region",{name:"Archived Recurring Quests",exact:true}):page.getByRole("list",{name:"Recurring definitions",exact:true});
  return scope.getByRole("listitem").filter({has:page.getByRole("heading",{name:title,exact:true})});
}
export async function createRecurring(page: Page){
  await page.getByRole("link",{name:"View today",exact:true}).click();
  const day=await page.getByLabel("Choose date",{exact:true}).inputValue();
  const title=`Retirement ${randomUUID()}`;
  const form=page.getByRole("region",{name:"Create Quest",exact:true});
  await form.getByLabel("Quest type",{exact:true}).selectOption("daily");
  await form.getByLabel("Title",{exact:true}).fill(title);
  await form.getByLabel("Reward EXP",{exact:true}).fill(String(rewardExp));
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
