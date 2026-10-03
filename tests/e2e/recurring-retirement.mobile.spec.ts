import { test, expect } from "./quest-fixtures";
import { createRecurring, recurringRow, retire } from "./recurring-retirement-helpers";

test("recurring retirement actions and disclosure remain usable at phone widths",async({page},testInfo)=>{
  const {title}=await createRecurring(page);
  for(const width of [360,390,412]){
    await page.setViewportSize({width,height:800});
    const button=recurringRow(page,title).getByRole("button",{name:"Archive",exact:true});
    await button.scrollIntoViewIfNeeded();expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await retire(page,title,"archive");await expect(recurringRow(page,title,true)).toBeVisible();
    await recurringRow(page,title,true).screenshot({path:testInfo.outputPath(`archived-recurring-${width}.png`)});
    await retire(page,title,"restore");await expect(recurringRow(page,title)).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true);
  }
  await retire(page,title,"archive");await expect(recurringRow(page,title,true)).toBeVisible();
  await retire(page,title,"delete");await expect(recurringRow(page,title,true)).toHaveCount(0);
});
