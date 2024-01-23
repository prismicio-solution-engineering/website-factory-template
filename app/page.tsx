import { createClient } from "@/prismicio";
import { SliceZone } from "@prismicio/react";
import { components } from "@/slices/index"
import Header from "@/components/Header";

export default async function Page({ }) {
  const client = createClient();

  const page = await client.getSingle("home_page");

  //theme
  const theme = await client.getSingle("theme");

  return(
  <>
    <Header theme={theme}/>
    <SliceZone slices={page.data.slices} components={components} context={{ theme }} />;
  </>
  )
}