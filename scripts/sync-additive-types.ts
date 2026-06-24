import { syncCanonicalAdditiveTypes } from "../src/lib/additives/ensureSeedAdditiveTypes";

import { prisma } from "../src/lib/prisma";



async function main() {

  const result = await syncCanonicalAdditiveTypes();

  console.log(

    `Additive catalog synced: ${result.upserted} canonical row(s), ${result.deleted} other row(s) removed.`

  );

}



main()

  .catch((err) => {

    console.error(err);

    process.exit(1);

  })

  .finally(async () => {

    await prisma.$disconnect();

  });

