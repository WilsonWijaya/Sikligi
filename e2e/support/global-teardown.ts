import { cleanTestData } from "./cleanup";

export default async function globalTeardown() {
  await cleanTestData();
}
