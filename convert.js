const fs = require('fs');
const YAML = require('js-yaml');

// Read Gravity Forms JSON export file, change name for new json export
const gravityFormsData = JSON.parse(fs.readFileSync('gravityforms-export-2024-03-14.json'));

// Set to true if every page is paginated
const START_WITH_PAGE = true;

const formFields = gravityFormsData['0']['fields'];

if (START_WITH_PAGE) {
  const startPage = {
    "type": "page",
    "id": 'start_page',
    "label": "Start Page",
    "adminLabel": "",
  };

  formFields.unshift(startPage);
}

// Map Gravity Forms field types to Drupal Webform field types
// GF type: Drupal Type
const fieldMap = {
  'page': 'wizard_page',
  'section': 'section',
  'text': 'textfield',
  'textarea': '',
  'email': 'email',
  'content': 'markup',
  'select': 'select',
  'date': 'date',
  'radio': 'radios',
  'fileupload': 'managed_file',
};

/**
 * Generate a unique field key for drupal
 * @param {object} field the field object from gravity forms
 * @param {int} count the current count for the number of fields we've gone through to set unique id's
 * @returns unique field ID
 */
const generateFieldKey = (field, count) => {
  return field.label ? field.label.substring(0, 8).toLowerCase().replaceAll(/[^\w\s]/gi, '_').replaceAll(' ', '_') + `_${count}` : `${field.type}_${field.id}`;
}

/**
 * Searches for the field by field ID and generates the input value for Drupal conditional fields
 * @param {object} fields all fields provided by gravity forms
 * @param {int} fieldID the field id we're searching for from gravity forms
 * @returns Drupal conditional field markup
 */
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

/**
 * 
 * @param {object} fields the object containing all fields from gravity forms
 * @returns drupal form object organized to work in Drupal Webforms
 */
function convertToYAML(fields) {
  const elements = {};

  const page = {
    start: false,
    end: false,
    building: false,
    key: '',
    count: 0,
    config: {},
  }

  const section = {
    start: false,
    end: false,
    building: false,
    key: '',
    count: '',
    config: {},
  };
  
  let fieldCount = 0;

  // Build each element
  fields.forEach((field, index) => {
    fieldCount++;

    page.start = field.type == 'page';
    section.start = field.type == 'section';
    page.end = index+1 < fields.length && fields[index + 1].type == 'page';
    section.end = index+1 < fields.length && fields[index + 1].type == 'section' || index+1 < fields.length && fields[index + 1].type == 'page';
    
    const fieldKey = generateFieldKey(field, fieldCount);
    const element = {};
    const options = {};
    const type = field.type;

    // Start a new page object if we're a page field
    if (page.start) {
      page.start = false;
      page.building = true;
      page.key = fieldKey;
      page.count++;
      page.config = {};
      page.config['#title'] = `Page ${page.count}`;
      page.config['#type'] = fieldMap[type];
    }

    // Start with a new section object if we're a section field
    if (section.start) {
      section.config = {};
      section.key = fieldKey;
      section.start = false;
      section.building = true;
      section.count++;
      section.config['#title'] = field.label;
      section.config['#type'] = fieldMap[type];
      section.config['#description'] = field.description;
    }

    // Build Element if not page or section
    if (!section.start && !page.start && type != 'section' && type != 'page') {

      if (field.label) {
        // We don't want titles on Basic HTML
        if (type != 'content' && type !== 'html') {
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

      if (field.maxLength) {
        element['#maxlength'] = field.maxLength;
      }

      if (field.minLength) {
        // NOTE: minLength from GF is an assumption, I haven't seen an example of this
        element['#minLength'] = field.minLength;
      }

      if (field.placeholder) {
        element['#placeholder'] = field.placeholder;
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

            switch (rule.operator) {
              case 'is':
                rules.push({
                  [key]:{value: rule.value}
                });
                break;

              case '>':
                rules.push({
                  [key]: {
                    value: {
                      greater: rule.value,
                    }
                  }
                });
                break;

              // Cases below here are assumptions and untested
              case '<':
                rules.push({
                  [key]: {
                    value: {
                      less: rule.value,
                    }
                  }
                });
                break;

              case '<=':
                rules.push({
                  [key]: {
                    value: {
                      less_equal: rule.value,
                    }
                  }
                });
                break;
            }
          });


          conditionalLogic['visible'] = rules;
        }

        element['#states'] = conditionalLogic;
      }

      // Gravity Forms Name Field
      if (type == 'name') {
        element['#type'] = 'flexbox';

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
      if (section.building) {
        section.config[fieldKey] = element;
      } else if(page.building && !section.building && !page.start) {
        page.config[fieldKey] = element;
      } else {
        elements[fieldKey] = element;
      }
    }

    // Add finished section to current page or top level elements
    if (section.end && section.building) {
      if (page.building) {
        page.config[section.key] = section.config;
      } else {
        elements[section.key] = section.config;
      }

      section.building = false;
    }

    // Add finished page to top level elements
    if(page.end && page.building) {
      elements[page.key] = page.config;
    }
  });

  return elements;
}


// Convert Gravity Forms JSON to Drupal Webform YAML
const webformYAML = convertToYAML(formFields);

// Write the YAML data to a file
fs.writeFileSync('drupal-webform.yaml', YAML.dump(webformYAML));

console.log('Conversion completed. Drupal Webform YAML file created.');
