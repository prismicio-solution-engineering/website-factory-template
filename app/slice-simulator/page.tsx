"use client";

import { SliceSimulator } from "@slicemachine/adapter-next/simulator";
import { SliceZone } from "@prismicio/react";

import { components } from "../../slices";
import { createClient } from "@/prismicio";

export default async function SliceSimulatorPage() {
  const client = createClient();
  //theme
  const theme = await client.getSingle("theme");
  return (
    <SliceSimulator
      sliceZone={(props) => <SliceZone {...props} components={components} context={{theme}}/>}
    />
  );
}
