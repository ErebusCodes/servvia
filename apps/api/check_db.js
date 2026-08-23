const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('=== DATABASE STATE CHECK ===\n');
    
    const orgs = await prisma.organization.findMany({
      select: { id: true, name: true, slug: true }
    });
    console.log('Organizations:', orgs.length);
    orgs.forEach(org => console.log(`  - ${org.name} (${org.slug}): ${org.id}`));
    
    if (orgs.length === 0) {
      console.log('\n⚠️  No organizations found!');
      process.exit(0);
    }
    
    const verduraOrg = orgs.find(o => o.slug === 'verdura');
    if (!verduraOrg) {
      console.log('\n⚠️  No "verdura" organization found!');
      process.exit(0);
    }
    
    const orgId = verduraOrg.id;
    console.log(`\n✓ Using organization: "${verduraOrg.name}" (${orgId})\n`);
    
    const categories = await prisma.category.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, isActive: true }
    });
    console.log(`Categories in Verdura org: ${categories.length}`);
    categories.forEach(cat => console.log(`  - ${cat.name} (active: ${cat.isActive})`));
    
    const menuItems = await prisma.menuItem.findMany({
      where: { organizationId: orgId },
      select: { id: true, title: true, deletedAt: true }
    });
    console.log(`\nMenu items in Verdura org: ${menuItems.length}`);
    if (menuItems.length > 0) {
      const active = menuItems.filter(m => !m.deletedAt).length;
      const deleted = menuItems.filter(m => m.deletedAt).length;
      console.log(`  - Active: ${active}`);
      console.log(`  - Deleted (soft-deleted): ${deleted}`);
      if (menuItems.length <= 10) {
        console.log(`  Items:`);
        menuItems.forEach(item => {
          console.log(`    • ${item.title} (deleted: ${item.deletedAt !== null})`);
        });
      } else {
        console.log(`  Sample items:`);
        menuItems.slice(0, 5).forEach(item => {
          console.log(`    • ${item.title} (deleted: ${item.deletedAt !== null})`);
        });
      }
    }
    
    console.log('\n=== CONCLUSION ===');
    if (categories.length === 0 && menuItems.length === 0) {
      console.log('Database is EMPTY. Seed needs to be run.');
    } else if (categories.length > 0 && menuItems.length > 0) {
      console.log('Database has data. Seed was previously run.');
    } else {
      console.log('Database in inconsistent state (categories without items or vice versa).');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
