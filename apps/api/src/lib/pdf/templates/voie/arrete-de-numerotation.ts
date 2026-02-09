import { getImageDimensions } from '@/lib/utils/image.utils';
import { PdfDocument, xMargin } from '../../PDFDocument';
import { BaseLocale } from '@/shared/entities/base_locale.entity';
import { Voie } from '@/shared/entities/voie.entity';

type ArreteDeNumerotationParams = {
  baseLocale: BaseLocale;
  voie: Voie;
  planDeSituation?: Express.Multer.File;
};

export async function generateArreteDeNumerotation(
  params: ArreteDeNumerotationParams,
): Promise<string> {
  const { baseLocale, voie, planDeSituation } = params;

  let planDeSituationDataUrl = '';
  let planDeSituationDimensions: { width: number; height: number } | null =
    null;
  let imageFormat = '';
  if (planDeSituation) {
    const base64PlanDeSituation = planDeSituation.buffer.toString('base64');
    imageFormat = planDeSituation.mimetype.replace('image/', '');
    if (!['png', 'jpeg', 'jpg'].includes(imageFormat)) {
      throw new Error('Invalid file type. Only PNG and JPEG are allowed.');
    }
    planDeSituationDataUrl = `data:image/${imageFormat};base64,${base64PlanDeSituation}`;
    planDeSituationDimensions = await getImageDimensions(
      planDeSituationDataUrl,
    );
  }

  const doc = new PdfDocument();
  const maxWidth = doc.getDocInstance().internal.pageSize.width - 2 * xMargin;

  await doc.initDocument('Street Numbering Order', {
    nom: baseLocale.communeNom,
    code: baseLocale.commune,
  });

  doc
    .addText(`The Jurisdiction Authority of ${baseLocale.communeNom},`, {
      align: 'left',
    })
    .addText(
      `Pursuant to the authority granted under applicable state and local addressing ordinances,`,
      {
        align: 'justify',
        maxWidth,
      },
    )
    .addText(
      `Whereas the numbering of structures within the jurisdiction is a public safety measure necessary for emergency response, mail delivery, and utility services,`,
      {
        align: 'justify',
        maxWidth,
      },
    )
    .addText(
      `Whereas consistent and accurate address numbering benefits residents, businesses, and public services,`,
      {
        align: 'justify',
        maxWidth,
      },
    )
    .addText(
      `Whereas the initial numbering of addresses is the responsibility of the jurisdiction,`,
      {
        align: 'justify',
        maxWidth,
      },
    )
    .addNewPage()
    .changeFontSize(20)
    .addText(`IT IS HEREBY ORDERED:`, {
      align: 'center',
    })
    .changeFontSize(12)
    .addNewLine()
    .addText(
      `Section 1: Access to the properties is via ${voie.nom}. The
numbering of the parcels is prescribed as follows:`,
      {
        align: 'justify',
      },
    )
    .addGenericTable(
      ['Number', 'Associated Parcel(s)'],
      voie.numeros
        .sort((a, b) => {
          if (a.numero !== b.numero) return a.numero - b.numero;
          const suffixA = a.suffixe || '';
          const suffixB = b.suffixe || '';
          return suffixA.localeCompare(suffixB);
        })
        .map(({ numeroComplet, parcelles }) => [
          `${numeroComplet}`,
          parcelles.join(', ') || '-',
        ]),
      {},
    )
    .addNewLine()
    .addNewLine()
    .addText(
      `Section 2: A numbering plan shall be filed with the public works department and made
available to the public.`,
      {
        align: 'justify',
        maxWidth,
      },
    )
    .addNewLine()
    .addText(
      `Section 3: Address numbers shall be furnished and installed by the jurisdiction; ongoing
maintenance shall be the responsibility of the property owners.`,
      {
        align: 'justify',
        maxWidth,
      },
    );

  if (planDeSituation) {
    doc
      .addNewPage()
      .addNewLine()
      .addText('Site Plan:', { align: 'left' })
      .addImage(planDeSituationDataUrl, imageFormat as 'png' | 'jpeg' | 'jpg', {
        width: maxWidth,
        height:
          planDeSituationDimensions.height *
          (maxWidth / planDeSituationDimensions.width),
      });
  }

  return doc.render();
}
