const fs = require('fs');
const YAML = require('js-yaml');

// Read Gravity Forms JSON export file
const gravityFormsData = JSON.parse(fs.readFileSync('gravityforms-export-2024-03-14.json'));

const formInfo = gravityFormsData['0'];
const formFields = gravityFormsData['0']['fields'];

// Map Gravity Forms field types to Drupal Webform field types
// GF type: Drupal Type
const fieldMap = {
  'page': 'wizard_page',
  'section': 'section',
  'fieldset': 'fieldset', // assumption
  'text': 'textfield',
  'email': 'email',
  'content': 'markup',
  'select': 'select',
  'date': 'date',
  'radio': 'radios',
};

const generateFieldKey = (field, count) => {
  return field.label ? field.label.substring(0, 8).toLowerCase().replaceAll(/[^\w\s]/gi, '_').replaceAll(' ', '_') + `_${count}` : `${field.type}_${field.id}`;
}

const getReferencedInput = (fields, fieldID) => {
  let input = 'not found';
  let fieldCount = 0;
  
  fields.forEach(field => {
    fieldCount++;
    if (field.id == fieldID) {
      const key = generateFieldKey(field, fieldCount);
      input = `:input[name="${key}"]`;
      return;
    }
  });

  return input;
}

// Function to convert Gravity Forms JSON to Drupal Webform YAML
function convertToYAML(fields) {
  const elements = {};
  let page = {}
  let startPage = false;
  let endPage = false;
  let startNewPage = false;
  let buildingPage = false;
  let pageKey = '';
  let pageCount = 0;

  let section = {};
  let startSection = false;
  let endSection = false;
  let startNewSection = false;
  let buildingSection = false;
  let sectionKey = '';
  let sectionCount = '';
  
  let fieldCount = 0;

  // Build each element
  fields.forEach((field, index) => {
    fieldCount++;
    startPage = field.type == 'page';
    startSection = field.type == 'section';
    endPage = index+1 < fields.length && fields[index + 1].type == 'page';
    endSection = index+1 < fields.length && fields[index + 1].type == 'section' || index+1 < fields.length && fields[index + 1].type == 'page';
    const fieldKey = generateFieldKey(field, fieldCount);
    const element = {};
    const options = {};
    const type = field.type;

    // Start a new page object if we're a page field
    if (startPage) {
      startPage = false;
      buildingPage = true;
      page = {};
      pageKey = fieldKey;
      pageCount++;
      page['#title'] = `Page ${pageCount}`;
      page['#type'] = fieldMap[type];
    }

    // Start with a new section object if we're a section field
    if (startSection) {
      section = {};
      sectionKey = fieldKey;
      startSection = false;
      buildingSection = true;
      sectionCount++;
      section['#title'] = field.label;
      section['#type'] = fieldMap[type];
      section['#description'] = field.description;
    }

    // Build Element if not page or section
    if (!startSection && !startPage && type != 'section' && type != 'page') {

      if (field.label) {
        // We don't want titles on Basic HTML
        if (type != 'content') {
          element['#title'] = field.label;
        }
      }
  
      if (type) {
        element['#type'] = fieldMap[field.type];
      }
  
      if (field.content) {
        element['#markup'] = field.content;
      }
  
      if (field.isRequired) {
        element['#required'] = field.isRequired;
      }

      if (field.choices) {
        field.choices.forEach(choice => {
          options[choice.value] = choice.text;
        });

        element['#options'] = options;
      }

      // Handle conditional logic
      if (field.conditionalLogic) {
        const actionType = field.conditionalLogic.actionType;
        const sourceRules = field.conditionalLogic.rules;
        const conditionalLogic = {};

        // Handle Show logic
        if (actionType == 'show') {
          const rules = []

          sourceRules.forEach((rule, index) => {
            if (index > 0) {
              rules.push('or');
            }

            const key = getReferencedInput(fields, rule.fieldId);
            rules.push({[key]: 
              {value: rule.value}
            })
          });


          conditionalLogic['visible'] = rules;
        }

        element['#states'] = conditionalLogic;
      }

      // Gravity Forms Name Field
      if (type == 'name') {
        element['#type'] = 'fieldset';

        const firstName = {};
        firstName['#title'] = 'First Name';
        firstName['#type'] = 'textfield';
        firstName['#required'] = field.isRequired;

        const lastName = {};
        lastName['#title'] = 'First Name';
        lastName['#type'] = 'textfield';
        lastName['#required'] = field.isRequired;

        element[`first_name_${fieldCount}`] = firstName;
        element[`last_name_${fieldCount}`] = lastName;
      }

      // Add element to appropriate object (page/top level)
      if (buildingSection) {
        section[fieldKey] = element;
      } else if(buildingPage && !buildingSection && !startPage) {
        page[fieldKey] = element;
      } else {
        elements[fieldKey] = element;
      }
    }

    // Add finished page to top level elements
    if(endPage && buildingPage) {
      elements[pageKey] = page;
      return;
    }

    // Add finished section to current page or top level elements
    if (endSection && buildingSection) {
      if (buildingPage) {
        page[sectionKey] = section;
      } else {
        elements[sectionKey] = section;
      }

      buildingSection = false;
      return
    }

  });

  return elements;
}


// Convert Gravity Forms JSON to Drupal Webform YAML
const webformYAML = convertToYAML(formFields);

// Write the YAML data to a file
fs.writeFileSync('drupal-webform.yaml', YAML.dump(webformYAML));

console.log('Conversion completed. Drupal Webform YAML file created.');
